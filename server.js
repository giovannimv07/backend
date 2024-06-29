const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { ObjectId } = require("mongodb");
const dgram = require("dgram");

const path = require("path");
const PORT = process.env.PORT || 5000;

const app = express();

app.set("port", process.env.PORT || 5000);

app.use(cors());
app.use(bodyParser.json());

app.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});

/**********************************************************************************
 *
 * ARDUINO
 *
 **********************************************************************************/
const udpClient = dgram.createSocket("udp4");
const ARDUINO_IP = "192.168.0.26"; // Replace with your Arduino's IP address
// const ARDUINO_IP = "172.20.10.6"; // Replace with your Arduino's IP address
const ARDUINO_PORT = 2390; // The port your Arduino is listening on
let lastCommand = "";

app.post("/api/sendCommand", (req, res) => {
	const { command } = req.body;
	const message = Buffer.from(command);
	console.log(`Sending message: ${message} to ${ARDUINO_IP}:${ARDUINO_PORT}`);

	udpClient.send(message, ARDUINO_PORT, ARDUINO_IP, (err) => {
		if (err) {
			console.error(`Error sending message: ${err}`);
			res.status(500).json({
				error: "Failed to send command to Arduino",
			});
		} else {
			console.log("Message sent successfully");
			res.status(200).json({ message: "Command sent successfully" });
		}
	});
});

app.get("/api/getData", (req, res) => {
	const message = Buffer.from("request data");

	udpClient.send(message, ARDUINO_PORT, ARDUINO_IP, (err) => {
		if (err) {
			res.status(500).json({
				error: "Failed to request data from Arduino",
			});
		}
	});

	udpClient.once("message", (msg, rinfo) => {
		res.status(200).json({ data: msg.toString() });
	});
});

// Endpoint to send command to the Arduino
app.post("/arduino/command", (req, res) => {
	const { command } = req.body;
	lastCommand = command; // Store the last command received
	res.send("Command received");
});

// Endpoint for the Arduino to fetch the last command
app.get("/arduino/lastCommand", (req, res) => {
	res.json({ command: lastCommand });
});

/**********************************************************************************
 *
 * DATABASE
 *
 **********************************************************************************/

require("dotenv").config();
const url = process.env.MONGODB_URI;
const MongoClient = require("mongodb").MongoClient;
const client = new MongoClient(url);
client.connect(console.log("mongodb connected"));

app.use((req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader(
		"Access-Control-Allow-Headers",
		"Origin, X-Requested-With, Content-Type, Accept, Authorization"
	);
	res.setHeader(
		"Access-Control-Allow-Methods",
		"GET, POST, PATCH, DELETE, OPTIONS"
	);
	next();
});

/**********************************************************************************
 *
 * API Section
 *
 **********************************************************************************/
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

app.post("/api/register", async (req, res, next) => {
	//===========================================
	// incoming: firstName, lastName, email, username, password
	// outgoing: id, firstName, lastName, error
	//===========================================

	const { firstName, lastName, email, username, password, code } = req.body;

	const newUser = {
		FirstName: firstName,
		LastName: lastName,
		Email: email,
		Login: username,
		Password: password,
		TokenKey: code,
		Verified: false,
	};
	var id = -1;
	var fn = "";
	var ln = "";
	var error = "";
	// Check for duplicate users
	try {
		const db = client.db("SDP");
		const duplicateUser = await db
			.collection("Users")
			.find({ Login: username })
			.toArray();

		if (duplicateUser.length > 0) {
			return res.status(409).json({ error: "Username taken" });
		}

		const duplicateEmail = await db
			.collection("Users")
			.find({ Email: email })
			.toArray();

		if (duplicateEmail.length > 0) {
			return res.status(409).json({
				error: "There is an account with that email use forget password",
			});
		}

		const result = await db.collection("Users").insertOne(newUser);
		id = result.insertedId;
		fn = firstName;
		ln = lastName;
	} catch (e) {
		error = e.toString();
	}

	var ret = { id: id, firstName: fn, lastName: ln, error: error };
	res.status(error ? 500 : 200).json(ret);
});

app.post("/api/login", async (req, res, next) => {
	//===========================================
	// incoming: login, password
	// outgoing: everything in the user document, error
	//===========================================

	var error = "";

	const { login, password } = req.body;

	const db = client.db("SDP");

	const usernames = await db
		.collection("Users")
		.find({ Login: login })
		.toArray();
	if (usernames.length == 0) {
		error = "Username not found";
		return res.status(409).json({ error: error });
	}
	// const passwords = await db
	// 	.collection("Users")
	// 	.find({ Password: password })
	// 	.toArray();
	// if (passwords.length == 0) {
	// 	error = "Password not found";
	// 	return res.status(409).json({ error: error });
	// }

	const results = await db
		.collection("Users")
		.find({ Login: login, Password: password })
		.toArray();

	var id = -1;
	var fn = "";
	var ln = "";
	var email = "";
	var code = -1;
	var verified = false;

	if (results.length > 0) {
		id = results[0]._id;
		fn = results[0].FirstName;
		ln = results[0].LastName;
		email = results[0].Email;
		code = results[0].TokenKey;
		verified = results[0].Verified;
	} else {
		error = "No Record Found";
	}

	var ret = {
		id: id,
		firstName: fn,
		lastName: ln,
		email: email,
		code: code,
		verified: verified,
		error: error,
	};
	res.status(200).json(ret);
});

app.post("/api/changePass", async (req, res, next) => {
	// ==========================================
	// incoming: email, newPass
	// outgoing: error
	// ==========================================

	const { email, newPass } = req.body;
	var error = "";

	try {
		const db = client.db("SDP");
		var updatedUser = await db
			.collection("Users")
			.findOneAndUpdate(
				{ Email: email },
				{ $set: { Password: newPass } }
			);
		if (!updatedUser) {
			error = "User not found";
			return res.status(409).json({ error: error });
		}
	} catch (e) {
		error = e.toString();
	}

	res.status(200).json({ error: error });
});

app.post("/api/delete", async (req, res, next) => {
	//===========================================
	// incoming: userId
	// outgoing: error
	//===========================================
	const { userId } = req.body;
	var error = "";
	try {
		const db = client.db("SDP");
		var user = await db
			.collection("Users")
			.findOneAndDelete({ _id: new ObjectId(userId) });
		if (!user) {
			error = "User not found";
			return res.status(409).json({ error: error });
		}
	} catch (e) {
		error = e.toString();
	}

	res.status(200).json({ error: error });
});

app.post("/api/email", async (req, res, next) => {
	//===========================================
	// incoming: emailTo, message, subject
	// outgoing: error
	//===========================================

	var error = "";
	const { emailTo, message, subject } = req.body;

	const OAuth2 = google.auth.OAuth2;

	const oauth2Client = new OAuth2(
		process.env.CLIENT_ID,
		process.env.CLIENT_SECRET,
		process.env.REDIRECT_URIS
	);

	oauth2Client.setCredentials({
		refresh_token: process.env.REFRESH,
	});

	const accessToken = oauth2Client.getAccessToken();

	const smtpTransport = nodemailer.createTransport({
		service: process.env.SERVICE,
		auth: {
			type: process.env.TYPE,
			user: process.env.USERSD,
			clientId: process.env.CLIENT_ID,
			clientSecret: process.env.CLIENT_SECRET,
			refreshToken: process.env.REFRESH,
			accessToken: accessToken,
		},
	});

	const mailOptions = {
		from: process.env.FROM,
		to: emailTo,
		subject: subject,
		generateTextFromHTML: true,
		html: `<div><p>${message}</p></div>`,
	};

	smtpTransport.sendMail(mailOptions, (error, response) => {
		let ret = error
			? { response: "", error: error.message }
			: { response: "Success", error: "" };
		res.status(200).json(ret);
		smtpTransport.close();
		//return error ? "error in email" : "";
	});
});

app.post("/api/verify", async (req, res, next) => {
	//===========================================
	// incoming: code
	// outgoing: error
	//===========================================
	// const { token } = req.params;
	const { code } = req.body;

	try {
		// Find the user in the database by the verification token
		const db = client.db("SDP");
		var user = await db
			.collection("Users")
			.findOneAndUpdate(
				{ TokenKey: code },
				{ $set: { Verified: true, TokenKey: null } }
			);

		if (user == null) {
			return res.status(404).json("Invalid Code");
		}

		res.status(200).json(
			"Email verification successful. You can now log in."
		);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: error.toString() });
	}
});

app.get("/api/user/:id", async (req, res, next) => {
	//===========================================
	// incoming: id (user ID)
	// outgoing: user information or error
	//===========================================
	const userId = req.params.id;

	try {
		const db = client.db("SDP");
		const user = await db
			.collection("Users")
			.findOne({ _id: new ObjectId(userId) });

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Send the user information back to the client
		res.status(200).json(user);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: error.toString() });
	}
});

app.post("/api/update", async (req, res, next) => {
	//===========================================
	// incoming: userId, firstName, lastName, email, changed
	// outgoing: error
	//===========================================
	const { userId, firstName, lastName, email, changed } = req.body;
	var error = "";
	try {
		const db = client.db("SDP");
		var user = await db.collection("Users").findOneAndUpdate(
			{ _id: new ObjectId(userId) },
			{
				$set: {
					FirstName: firstName,
					LastName: lastName,
					Email: email,
					Verified: !changed,
					TokenKey: changed
						? Math.floor(100000 + Math.random() * 900000)
						: null,
				},
			}
		);
		// console.log(`Value: ${user}`);
		if (!user) {
			error = "User not found";
			return res.status(409).json({ error: error });
		}
	} catch (e) {
		error = e.toString();
	}

	res.status(200).json({ error: error });
});
