const mysql = require('mysql2');

// Railway often provides MYSQL* variables (depending on how you added the DB)
const host =
  process.env.DB_HOST ||
  process.env.MYSQLHOST ||
  process.env.MYSQL_HOST ||
  'localhost';

const port = Number(
  process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306
);

const user =
  process.env.DB_USER ||
  process.env.MYSQLUSER ||
  process.env.MYSQL_USER ||
  'root';

const password =
  process.env.DB_PASSWORD ||
  process.env.MYSQLPASSWORD ||
  process.env.MYSQL_PASSWORD ||
  '';

const database =
  process.env.DB_NAME ||
  process.env.MYSQLDATABASE ||
  process.env.MYSQL_DATABASE ||
  'railway'; // safest default for Railway

const db = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.getConnection((err, connection) => {
  if (err) {
    console.error('❌ MySQL connection failed (full):', err);
  } else {
    console.log('✅ MySQL connected successfully:', { host, port, database });
    connection.release();
  }
});

module.exports = db;
