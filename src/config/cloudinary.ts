import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const CLOUDINARY_CREW_FOLDER = "marine-flight/crew";
export const CLOUDINARY_CREW_TICKET_FOLDER = "marine-flight/crew-tickets";

export default cloudinary;
