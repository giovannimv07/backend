const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { ObjectId } = require("mongodb");
const dgram = require("dgram");
const https = require("https");

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
const udpPort = 5001;
// const ARDUINO_IP = process.env.IP_ARDUINO;
let ARDUINO_IP = "";
const ARDUINO_PORT = 2390;
let latestSensorData = "";

udpClient.on("listening", () => {
	const address = udpClient.address();
	console.log(`UDP Server listening on ${address.address}:${address.port}`);
});

udpClient.on("message", (message, remote) => {
	const data = message.toString().trim();

	if (data.startsWith("GPS")) {
		const coordinates = data.substring(4).trim(); // Remove "GPS " prefix
		const [latitude, longitude] = coordinates.split(",");

		// BigDataCloud Reverse Geocoding API endpoint
		const apiUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;

		// HTTP GET request to fetch address
		https
			.get(apiUrl, (response) => {
				let data = "";

				// A chunk of data has been received
				response.on("data", (chunk) => {
					data += chunk;
				});

				// The whole response has been received
				response.on("end", () => {
					try {
						const parsedData = JSON.parse(data);
						if (parsedData.locality) {
							const address = parsedData.locality;
							console.log(
								`Received GPS coordinates from Arduino (${latitude}, ${longitude}):`
							);
							console.log(`Address: ${address}`);
							// Here you can handle the address as needed
						} else {
							console.log(
								"No address found for the given coordinates."
							);
						}
					} catch (error) {
						console.error("Error parsing response:", error);
					}
				});
			})
			.on("error", (error) => {
				console.error("Error fetching address:", error);
			});

		console.log(
			`Received GPS data from ${remote.address}:${remote.port}: ${data}`
		);
	} else if (data.startsWith("AR")) {
		const arduinoIP = remote.address;
		if (arduinoIP !== ARDUINO_IP) {
			ARDUINO_IP = arduinoIP;
			console.log(`Arduino IP address updated to: ${arduinoIP}`);
		}
		console.log(
			`Received Arduino IP address from ${remote.address}:${remote.port}: ${data}`
		);
	} else if (data.startsWith("Sensor1")) {
		const sensorValue = data.split(" ")[1];
		latestSensorData = sensorValue;
		ARDUINO_IP = remote.address;
		console.log(
			`Received sensor value from ${remote.address}:${remote.port}: Value 1 ${sensorValue}`
		);
	} else if (data.startsWith("Sensor2")) {
		const sensorValue = data.split(" ")[1];
		latestSensorData = sensorValue;
		console.log(
			`Received sensor value from ${remote.address}:${remote.port}: Value 2 ${sensorValue}`
		);
	} else if (data.startsWith("Acknowledge")) {
		console.log(
			`Received acknowledgment from ${remote.address}:${remote.port}: ${data}`
		);
	} else {
		console.log(
			`Received unknown message from ${remote.address}:${remote.port}: ${data}`
		);
	}
	// console.log(
	// 	`Received message from ${remote.address}:${remote.port}: ${message}`
	// );
});

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

app.get("/api/getSensorData", (req, res) => {
	res.status(200).json({ sensorData: latestSensorData });
});

udpClient.bind(udpPort);

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
