import "dotenv/config";
import mongoose from "mongoose";
import "../models/admin.model";

const MONGO_URI = process.env.MONGO_URI || "mongodb://admin:password@localhost:27017/?authSource=admin";

async function main() {
  await mongoose.connect(MONGO_URI);
  const Admin = mongoose.model("Admin");
  const admins = await Admin.find({});
  console.log("All Admins in DB:", admins.map(a => ({ id: a._id, email: a.email, firstname: a.firstname })));
  mongoose.connection.close();
}

main().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
