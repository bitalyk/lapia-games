import mongoose from "mongoose";
import dotenv from 'dotenv';
dotenv.config();

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/lapia-games";

mongoose.connect(mongoUri)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

export default mongoose;
