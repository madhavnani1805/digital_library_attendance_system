const express = require("express");
const mysql2 = require("mysql2/promise");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");

const path = require('path');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json()); // Parse JSON bodies
app.use(express.static(__dirname + "/public")); // Serve static files

// MySQL Pool
const db = mysql2.createPool({
    host: "localhost",
    user: "root",
    password: "12345",
    database: "digital_library",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ✅ Test MySQL connection
(async () => {
    try {
        const [rows] = await db.query("SELECT 1");
        console.log("✅ Connected to MySQL Database.");
    } catch (err) {
        console.error("❌ MySQL connection failed:", err.message);
    }
})();

// Home Page
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

// Register User
app.post("/register", async (req, res) => {
    console.log("Request Body:", req.body);
    let { full_name, email, password, roll_no, branch } = req.body;

    // Validate input fields (no confirm_password here)
    if (!full_name || !email || !password || !roll_no || !branch) {
        return res.status(400).send("All fields are required.");
    }

    // Trim input
    full_name = full_name.trim();
    email = email.trim();
    password = password.trim();
    roll_no = roll_no.trim();
    branch = branch.trim();

    // Hash & store
    const hashedPassword = bcrypt.hashSync(password, 10);
    try {
        const [result] = await db.execute(
            "INSERT INTO users (full_name, roll_no, branch, email, password) VALUES (?, ?, ?, ?, ?)",
            [full_name, roll_no, branch, email, hashedPassword]
        );
        console.log("✅ User created:", result);
        res.status(200).send("User registered successfully.");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error registering user.");
    }
});

// Login User
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);

        if (rows.length === 0) {
            return res.status(400).send("Invalid credentials.");
        }

        const user = rows[0];
        const passwordMatch = bcrypt.compareSync(password, user.password);

        if (passwordMatch) {
            res.status(200).send("Login successful.");
        } else {
            res.status(400).send("Invalid credentials.");
        }
    } catch (err) {
        console.error("❌ Error during login:", err.message);
        res.status(500).send("Internal Server Error.");
    }
});

// Save Attendance from QR Code
app.post("/mark-attendance", async (req, res) => {
    const { qrData } = req.body;
    if (!qrData) {
        return res.status(400).json({ success: false, message: "QR data is missing" });
    }
    let payload;
    try {
        payload = JSON.parse(qrData);
    } catch {
        return res.status(400).json({ success: false, message: "Invalid QR data format" });
    }
    const { roll_no, name: ignored, branch } = payload;
    if (!roll_no || !branch) {
        return res.status(400).json({ success: false, message: "Missing required information in QR data" });
    }

    let conn;
    try {
        // 1) grab a dedicated connection from the pool
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 2) verify user exists
        const [users] = await conn.execute(
            "SELECT full_name FROM users WHERE roll_no = ?",
            [roll_no]
        );
        if (!users.length) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "User not found" });
        }
        const full_name = users[0].full_name;

        // 3) check if today’s attendance already exists
        const [att] = await conn.execute(
            "SELECT id FROM attendance WHERE roll_no = ? AND DATE(created_at) = CURDATE()",
            [roll_no]
        );
        if (att.length) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: "Attendance already marked for today." });
        }

        // 4) insert new attendance (no stray comma!)
        await conn.execute(
            "INSERT INTO attendance (roll_no, full_name, branch) VALUES (?, ?, ?)",
            [roll_no, full_name, branch]
        );

        // 5) commit and respond
        await conn.commit();
        return res.json({ success: true, message: "Attendance marked successfully." });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error("🔥 Error in /mark-attendance:", err);
        return res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// Admin route to fetch attendance
app.get('/admin', async (req, res) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM attendance ORDER BY created_at DESC'
      );
      res.json(rows);
    } catch (err) {
      console.error('🔥 Error fetching attendance:', err.message);
      console.error(err); // SHOW FULL ERROR
      res.status(500).send('Server error');
    }
  });

// Serve QR Code Generation Page
app.get("/qr.html", (req, res) => {
    res.sendFile(__dirname + "/public/qr.html");
});

// Start Server
app.listen(PORT, () => {
console.log(`🚀 Server running at http://localhost:${PORT}`);
console.log("👀 Inside /admin route");
});