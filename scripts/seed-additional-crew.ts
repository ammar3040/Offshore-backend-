import "dotenv/config";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { connectDB } from "../src/dbconnection";
import { createCrew } from "../src/models/crew.model";
import "../src/models/admin.model";
import "../src/models/superadmin.model";

const DEMO_PASSWORD = "Demo@123";

const PLACEHOLDER_DOC = "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg";

const FIRST_NAMES = [
  "Lars", "Sofia", "Liam", "Anya", "Hiroshi", "Amara", "Carlos", "Elena", "Sven",
  "Chloe", "Mateo", "Priya", "Hans", "Astrid", "Dimitri", "Fatima", "Jean", "Yuki"
];

const LAST_NAMES = [
  "Nielsen", "Martins", "O'Connor", "Kovalev", "Sato", "Diallo", "Silva", "Rostova",
  "Hansen", "Dubois", "Rodriguez", "Patel", "Müller", "Berg", "Petrov", "Ali", "Dupont", "Tanaka"
];

const NATIONALITIES = [
  "Danish", "Portuguese", "Irish", "Russian", "Japanese", "Nigerian", "Brazilian",
  "Latvian", "Norwegian", "French", "Spanish", "Indian", "German", "Angolan", "British"
];

const ORGANIZATIONS = [
  "Maersk Drilling", "Galp Energia", "Irish Sea Exploration", "Rosneft Marine",
  "JAPEX Offshore", "NNPC Offshore", "Gulf Offshore Exploration", "Equinor", "BP Marine", "Transocean"
];

function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomDate(start: Date, end: Date): string {
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString().split("T")[0];
}

async function seed() {
  await connectDB();
  
  // Find any existing admin
  const AdminModel = mongoose.model("Admin");
  let admin = await AdminModel.findOne();
  
  if (!admin) {
    // Check if SuperAdmin exists as a fallback
    const SuperAdminModel = mongoose.model("SuperAdmin");
    admin = await SuperAdminModel.findOne();
  }

  if (!admin) {
    console.error("No admin or superadmin found in database. Please seed admin/superadmin first.");
    process.exit(1);
  }
  
  console.log(`Seeding 6 dynamic mock crew members created by admin/superadmin: ${admin.email}...`);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  
  for (let i = 0; i < 6; i++) {
    const first = getRandomElement(FIRST_NAMES);
    const last = getRandomElement(LAST_NAMES);
    const nat = getRandomElement(NATIONALITIES);
    const org = getRandomElement(ORGANIZATIONS);
    const isAvailable = Math.random() > 0.4; // 60% chance to be available
    
    // Generate a unique suffix using random numbers
    const suffix = Math.floor(100 + Math.random() * 900);
    const email = `dynamic-crew-${first.toLowerCase()}-${last.toLowerCase()}-${suffix}@demo.local`;
    
    // Check if email already exists
    const CrewModel = mongoose.model("Crew");
    const existing = await CrewModel.findOne({ email });
    if (existing) {
      console.log(`Crew member with email ${email} already exists, skipping.`);
      i--; // Retry this index
      continue;
    }
    
    const crew = await createCrew({
      createdBy: admin._id as mongoose.Types.ObjectId,
      firstname: first,
      lastname: last,
      dateOfBirth: getRandomDate(new Date(1975, 0, 1), new Date(2000, 11, 31)),
      nationality: nat,
      gender: Math.random() > 0.5 ? "male" : "female",
      email: email,
      phone: `+44 7700 900${300 + suffix}`,
      alternate_phone: `+44 7700 900${400 + suffix}`,
      address: `${Math.floor(10 + Math.random() * 90)} Offshore Boulevard`,
      city: getRandomElement(["Aberdeen", "Houston", "Stavanger", "Oslo", "Rio de Janeiro"]),
      country: getRandomElement(["United Kingdom", "United States", "Norway", "Brazil"]),
      postal_code: `AB${10 + i} ${i}XX`,
      password: passwordHash,
      passport: {
        passport_number: `P${70000000 + suffix}`,
        issue_date: getRandomDate(new Date(2020, 0, 1), new Date(2023, 11, 31)),
        expiry_date: getRandomDate(new Date(2030, 0, 1), new Date(2033, 11, 31)),
        issuing_country: "GB",
        passport_document: PLACEHOLDER_DOC,
      },
      identity: {
        identity_type: "national_id" as any,
        identity_number: `ID${80000000 + suffix}`,
        issue_date: getRandomDate(new Date(2020, 0, 1), new Date(2023, 11, 31)),
        expiry_date: getRandomDate(new Date(2030, 0, 1), new Date(2033, 11, 31)),
        identity_document: PLACEHOLDER_DOC,
      },
      crew_certificate: [
        {
          certificate_name: getRandomElement(["BOSIET", "HUET", "FOET", "OPITO"]),
          issue_date: getRandomDate(new Date(2023, 0, 1), new Date(2024, 11, 31)),
          expiry_date: getRandomDate(new Date(2027, 0, 1), new Date(2028, 11, 31)),
          certificate_document: PLACEHOLDER_DOC,
        }
      ],
      organization: org,
      isAvailable: isAvailable,
    });
    
    console.log(`Created Crew Member [${i + 1}/6]: ${crew.firstname} ${crew.lastname} (${crew.email}) - isAvailable: ${crew.isAvailable}`);
  }
  
  console.log("Seeding completed successfully.");
}

seed()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Seeding failed:", err);
    await mongoose.disconnect();
    process.exit(1);
  });

