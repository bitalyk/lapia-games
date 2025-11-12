import mongoose from "mongoose";

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/clickerdb";

mongoose.connect(mongoUri)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

export default mongoose;
