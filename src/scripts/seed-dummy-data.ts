import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

// Import model files to register schemas with Mongoose
import "../models/admin.model";
import "../models/superadmin.model";
import "../models/crew.model";
import "../models/rig.model";
import "../models/project.model";
import "../models/crewTicket.model";
import "../models/adminInvoice.model";
import "../models/crewAvailability.model";
import "../models/crewInvite.model";
import "../models/timesheet.model";
import "../models/payroll.model";

const MONGO_URI = process.env.MONGO_URI || "mongodb://admin:password@localhost:27017/?authSource=admin";
const PASSWORD_PLAIN = "Test@123";

async function seed() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB successfully.");

  // Retrieve Mongoose models
  const Admin = mongoose.model("Admin");
  const SuperAdmin = mongoose.model("SuperAdmin");
  const Crew = mongoose.model("Crew");
  const Rig = mongoose.model("Rig");
  const Project = mongoose.model("Project");
  const CrewTicket = mongoose.model("CrewTicket");
  const AdminInvoice = mongoose.model("AdminInvoice");
  const CrewAvailability = mongoose.model("CrewAvailability");
  const CrewInvite = mongoose.model("CrewInvite");
  const Timesheet = mongoose.model("Timesheet");
  const Payroll = mongoose.model("Payroll");

  // Clean all existing data in these collections
  console.log("Cleaning existing database data...");
  await Promise.all([
    Admin.deleteMany({}),
    SuperAdmin.deleteMany({}),
    Crew.deleteMany({}),
    Rig.deleteMany({}),
    Project.deleteMany({}),
    CrewTicket.deleteMany({}),
    AdminInvoice.deleteMany({}),
    CrewAvailability.deleteMany({}),
    CrewInvite.deleteMany({}),
    Timesheet.deleteMany({}),
    Payroll.deleteMany({}),
  ]);
  console.log("Database cleared.");

  // Hash password
  const hashedPassword = bcrypt.hashSync(PASSWORD_PLAIN, 10);

  // 1. Seed SuperAdmin
  console.log("Seeding SuperAdmin...");
  const superadminDoc = await SuperAdmin.create({
    firstname: "Super",
    lastname: "Admin",
    email: "superadmin@yopmail.com",
    password: hashedPassword,
    phone: "+1112223333",
    markup: 75,
    markupPercentage: 3,
    cashback: 15,
    cancellationCharges: 25,
  });
  console.log(`SuperAdmin created: ${superadminDoc.email}`);

  // 2. Seed Admin
  console.log("Seeding Admin...");
  const adminDoc = await Admin.create({
    firstname: "Admin",
    lastname: "User",
    email: "marine-admin@yopmail.com",
    password: hashedPassword,
    phone: "+9876543210",
    balance: 500000,
    cancellationOutstanding: 0,
    cancellationSlotsRemaining: 0,
  });
  console.log(`Admin created: ${adminDoc.email}`);

  // 3. Seed Rigs
  console.log("Seeding Oil Rigs...");
  const rigs = await Rig.insertMany([
    {
      name: "North Sea Alpha",
      address: "North Sea Sector 4B, Scotland",
      description: "Deepwater semi-submersible drilling rig optimized for harsh North Sea conditions.",
      createdBy: adminDoc._id,
    },
    {
      name: "Gulf Pioneer",
      address: "Gulf of Mexico Block 211, USA",
      description: "Ultra-deepwater drillship serving oil exploration contracts in the Gulf.",
      createdBy: adminDoc._id,
    },
    {
      name: "Atlantic Sentinel",
      address: "Grand Banks, Newfoundland, Canada",
      description: "Heavy duty jack-up rig suited for ice-prone Atlantic operations.",
      createdBy: adminDoc._id,
    },
  ]);
  console.log(`Seeded ${rigs.length} rigs.`);

  // 4. Seed Crew Members
  console.log("Seeding Crew Members...");
  const nationalities = ["British", "American", "Canadian", "Norwegian", "Azerbaijani", "Indian"];
  const ranks = [
    "Captain",
    "Chief Engineer",
    "First Officer",
    "Drilling Superintendent",
    "Safety Advisor",
    "Medic",
    "Subsea Engineer",
    "Roustabout",
    "Deckhand",
    "Crane Operator",
    "Welder",
    "Electrician",
  ];
  const organizations = ["Offshore Marine Services", "Statoil Services", "Deepwater Partners", "Apex Drilling"];

  const crewDetails = [
    {
      firstname: "John",
      lastname: "Smith",
      preferred_rating: "AAA",
      primary_bop_oem: "Cameron",
      secondary_skills: ["Tubing", "Controls"],
      current_status: "Available",
      last_worked: new Date("2026-05-10"),
      visa_details: { visa_country: "Norway", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2030-01-01", passport_number: "PP800001", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2020-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Mark",
      lastname: "Jones",
      preferred_rating: "AA",
      primary_bop_oem: "NOV",
      secondary_skills: ["Hydraulics"],
      current_status: "Offered",
      last_worked: new Date("2026-04-15"),
      visa_details: { visa_country: "USA", visa_issue_date: "2023-01-01", visa_expiry_date: "2027-01-01" },
      passport: { expiry_date: "2025-01-01", passport_number: "PP800002", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2015-01-01" }, // Expired Passport
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Ahmed",
      lastname: "Ali",
      preferred_rating: "A",
      primary_bop_oem: "GE",
      secondary_skills: ["Electrical", "Fiber Optics"],
      current_status: "Confirmed",
      last_worked: new Date("2026-06-01"),
      visa_details: { visa_country: "Azerbaijan", visa_issue_date: "2023-01-01", visa_expiry_date: "2025-06-01" }, // Expired Visa
      passport: { expiry_date: "2032-01-01", passport_number: "PP800003", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2022-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Steve",
      lastname: "Brown",
      preferred_rating: "AAA",
      primary_bop_oem: "Cameron",
      secondary_skills: ["Subsea Gate Valves"],
      current_status: "On assignment for us",
      last_worked: new Date("2026-06-20"),
      visa_details: { visa_country: "UK", visa_issue_date: "2024-01-01", visa_expiry_date: "2029-01-01" },
      passport: { expiry_date: "2031-01-01", passport_number: "PP800004", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2021-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2020-01-10", expiry_date: "2025-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }, // Expired BOSIET
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Sarah",
      lastname: "Connor",
      preferred_rating: "AA",
      primary_bop_oem: "NOV",
      secondary_skills: ["Accumulator Safety"],
      current_status: "Offshore (Competitor)",
      last_worked: new Date("2026-05-01"),
      visa_details: { visa_country: "Norway", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2032-01-01", passport_number: "PP800005", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2022-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2023-05-15", expiry_date: "2025-05-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" } // Expired Medical
      ]
    },
    {
      firstname: "David",
      lastname: "Williams",
      preferred_rating: "None",
      primary_bop_oem: "Other",
      secondary_skills: ["General Mechanical"],
      current_status: "Holiday / Not Available",
      last_worked: new Date("2026-03-10"),
      visa_details: { visa_country: "Brazil", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2033-01-01", passport_number: "PP800006", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2023-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Elena",
      lastname: "Rostova",
      preferred_rating: "None",
      primary_bop_oem: "GE",
      secondary_skills: ["Controls Troubleshooting"],
      current_status: "Unknown / Inactive",
      last_worked: new Date("2025-12-01"),
      visa_details: { visa_country: "Azerbaijan", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2030-01-01", passport_number: "PP800007", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2020-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Rajesh",
      lastname: "Kumar",
      preferred_rating: "AAA",
      primary_bop_oem: "Cameron",
      secondary_skills: ["Choke Manifolds"],
      current_status: "Offshore (Competitor)",
      last_worked: new Date("2026-06-15"),
      visa_details: { visa_country: "Angola", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2032-01-01", passport_number: "PP800008", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2022-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Michael",
      lastname: "Chang",
      preferred_rating: "AA",
      primary_bop_oem: "NOV",
      secondary_skills: ["BOP Stack Control"],
      current_status: "Offshore (Competitor)",
      last_worked: new Date("2026-05-20"),
      visa_details: { visa_country: "USA", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2031-01-01", passport_number: "PP800009", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2021-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Igor",
      lastname: "Smirnov",
      preferred_rating: "A",
      primary_bop_oem: "GE",
      secondary_skills: ["Multiplex Controls"],
      current_status: "Available",
      last_worked: new Date("2026-06-10"),
      visa_details: { visa_country: "Norway", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2032-01-01", passport_number: "PP800010", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2022-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Jane",
      lastname: "Doe",
      preferred_rating: "AAA",
      primary_bop_oem: "Cameron",
      secondary_skills: ["Wellhead Systems"],
      current_status: "Available",
      last_worked: new Date("2026-06-05"),
      visa_details: { visa_country: "UK", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2032-01-01", passport_number: "PP800011", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2022-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    },
    {
      firstname: "Robert",
      lastname: "Miller",
      preferred_rating: "AA",
      primary_bop_oem: "NOV",
      secondary_skills: ["Marine Risers"],
      current_status: "Available",
      last_worked: new Date("2026-06-12"),
      visa_details: { visa_country: "USA", visa_issue_date: "2024-01-01", visa_expiry_date: "2028-01-01" },
      passport: { expiry_date: "2032-01-01", passport_number: "PP800012", issuing_country: "United Kingdom", passport_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf", issue_date: "2022-01-01" },
      certs: [
        { certificate_name: "BOSIET (Basic Offshore Safety Induction and Emergency Training)", issue_date: "2024-01-10", expiry_date: "2028-01-10", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" },
        { certificate_name: "Offshore Medical Certificate", issue_date: "2025-02-15", expiry_date: "2027-02-15", certificate_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf" }
      ]
    }
  ];

  const crewDataList = crewDetails.map((crew, idx) => {
    const nationality = nationalities[idx % nationalities.length];
    const org = organizations[idx % organizations.length];
    const rank = ranks[idx % ranks.length];

    return {
      firstname: crew.firstname,
      lastname: crew.lastname,
      dateOfBirth: `198${idx % 10}-0${(idx % 9) + 1}-15`,
      nationality,
      gender: idx % 2 === 0 ? "male" : "female",
      email: `crew${idx + 1}@a.com`,
      phone: `+4477009000${10 + idx}`,
      alternate_phone: `+4477009000${50 + idx}`,
      address: `${100 + idx} High Street, Offshore Haven`,
      city: "Aberdeen",
      country: "United Kingdom",
      postal_code: `AB${10 + idx} 4YZ`,
      password: hashedPassword,
      passport: crew.passport,
      identity: {
        identity_type: "national_id",
        identity_number: `NID${900000 + idx}`,
        issue_date: "2020-05-15",
        expiry_date: "2030-05-15",
        identity_document: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
      },
      crew_certificate: crew.certs,
      azerbaijan_vantage_number: `AZV${7000 + idx}`,
      norwegian_d_number: `NDN${6000 + idx}`,
      dawinci_number: `DAW${5000 + idx}`,
      vantage_number: `VAN${4000 + idx}`,
      organization: org,
      linkedin: `https://linkedin.com/in/crewmember${idx + 1}`,
      visa: `Visa Class C-1 | Expiry: 2028-10-12 | Country: Norway`,
      rank,
      isAvailable: true,
      createdBy: adminDoc._id,
      preferred_rating: crew.preferred_rating,
      primary_bop_oem: crew.primary_bop_oem,
      secondary_skills: crew.secondary_skills,
      current_status: crew.current_status,
      last_worked: crew.last_worked,
      visa_details: crew.visa_details,
    };
  });

  const crewDocs = await Crew.insertMany(crewDataList);
  console.log(`Seeded ${crewDocs.length} crew members.`);

  // 5. Seed Projects
  console.log("Seeding Projects...");
  const project1From = new Date();
  project1From.setDate(project1From.getDate() - 25); // Started 25 days ago
  const project1To = new Date();
  project1To.setDate(project1To.getDate() + 20); // Ends in 20 days

  const project2From = new Date();
  project2From.setDate(project2From.getDate() - 10); // Started 10 days ago
  const project2To = new Date();
  project2To.setDate(project2To.getDate() + 50); // Ends in 50 days

  const project3From = new Date();
  project3From.setDate(project3From.getDate() + 15); // Starts in 15 days
  const project3To = new Date();
  project3To.setDate(project3To.getDate() + 45); // Ends in 45 days

  const projects = await Project.insertMany([
    {
      title: "North Sea Extraction Phase 1",
      description: "Drilling operations and extraction setup for rig North Sea Alpha.",
      duration: {
        startDate: project1From,
        endDate: project1To,
      },
      span: "6 Weeks Rotation",
      status: "active",
      createdBy: adminDoc._id,
      participants: [crewDocs[0]._id, crewDocs[1]._id, crewDocs[2]._id, crewDocs[3]._id],
      rig_id: rigs[0]._id,
    },
    {
      title: "Gulf Exploration Survey",
      description: "Surveying seabed strata in block 211 of Gulf of Mexico.",
      duration: {
        startDate: project2From,
        endDate: project2To,
      },
      span: "8 Weeks Rotation",
      status: "active",
      createdBy: adminDoc._id,
      participants: [crewDocs[4]._id, crewDocs[5]._id, crewDocs[6]._id, crewDocs[7]._id],
      rig_id: rigs[1]._id,
    },
    {
      title: "Atlantic Maintenance Operations",
      description: "Scheduled structural maintenance and drilling system safety check.",
      duration: {
        startDate: project3From,
        endDate: project3To,
      },
      span: "4 Weeks Rotation",
      status: "onhold",
      createdBy: adminDoc._id,
      participants: [crewDocs[8]._id, crewDocs[9]._id, crewDocs[10]._id, crewDocs[11]._id],
      rig_id: rigs[2]._id,
    },
  ]);
  console.log(`Seeded ${projects.length} projects.`);

  // 6. Seed CrewAvailability
  console.log("Seeding Crew Availability...");
  const availabilityData: any[] = [];

  const getDates = (offsetStart: number, offsetEnd: number) => {
    const s = new Date();
    s.setDate(s.getDate() + offsetStart);
    const e = new Date();
    e.setDate(e.getDate() + offsetEnd);
    return { from: s, to: e };
  };

  crewDocs.forEach((crew) => {
    const name = crew.firstname;
    if (name === "John") {
      const range1 = getDates(0, 30);
      const range2 = getDates(-60, -35);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: true },
        { crew_id: crew._id, from: range2.from, to: range2.to, isAvailable: false, employer: "Subseaquence", client: "BP", rig_vessel: "Deepwater Atlas", country: "Angola", notes: "Completed subsea integration tour" }
      );
    } else if (name === "Mark") {
      const range1 = getDates(2, 35);
      const range2 = getDates(-50, -20);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: true },
        { crew_id: crew._id, from: range2.from, to: range2.to, isAvailable: false, employer: "GES", client: "Noble", rig_vessel: "Noble Venturer", country: "UK", notes: "Past assignment" }
      );
    } else if (name === "Ahmed") {
      const range1 = getDates(0, 15);
      const range2 = getDates(-40, -10);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: true },
        { crew_id: crew._id, from: range2.from, to: range2.to, isAvailable: false, employer: "SBS", client: "BP", rig_vessel: "Shah Deniz", country: "Azerbaijan", notes: "Working tour" }
      );
    } else if (name === "Steve") {
      const range1 = getDates(-15, 25);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: false, employer: "Subseaquence", client: "Transocean", rig_vessel: "Deepwater Atlas", country: "USA", notes: "On project North Sea Extraction Phase 1" }
      );
    } else if (name === "Sarah") {
      const range1 = getDates(-10, 20);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: false, employer: "GES", client: "Noble", rig_vessel: "Noble Venturer", country: "UK", notes: "Offshore competitor Stack maintenance" }
      );
    } else if (name === "David") {
      const range1 = getDates(-2, 8);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: false, employer: "Subseaquence", client: "Direct with Operator", rig_vessel: "None", country: "United Kingdom", notes: "Summer leave with family" }
      );
    } else if (name === "Rajesh") {
      const range1 = getDates(-12, 12);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: false, employer: "SBS", client: "Shell", rig_vessel: "Appomattox", country: "USA", notes: "Competitor SBS stack check" }
      );
    } else if (name === "Michael") {
      const range1 = getDates(-20, 15);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: false, employer: "RTC", client: "Equinor", rig_vessel: "Johan Castberg", country: "Norway", notes: "Competitor controls configuration" }
      );
    } else {
      const range1 = getDates(0, 30);
      const range2 = getDates(40, 80);
      availabilityData.push(
        { crew_id: crew._id, from: range1.from, to: range1.to, isAvailable: true },
        { crew_id: crew._id, from: range2.from, to: range2.to, isAvailable: true }
      );
    }
  });

  await CrewAvailability.insertMany(availabilityData);
  console.log("Seeded crew availability entries.");

  // 7. Seed CrewInvite (project contract links)
  console.log("Seeding Project Invites/Contracts...");
  const invitesData = [];

  // Project 1: Active, all accepted
  for (let i = 0; i < 4; i++) {
    invitesData.push({
      crew_id: crewDocs[i]._id,
      project_id: projects[0]._id,
      acceptanceStatus: "accepted",
      contract_title: "North Sea Phase 1 Crew Contract",
      contract_body: "Standard offshore worker service agreement with full terms and insurance benefits.",
      contract_signed_at: project1From,
      contract_end_date: project1To,
    });
  }

  // Project 2: Active, 3 accepted, 1 pending
  for (let i = 4; i < 7; i++) {
    invitesData.push({
      crew_id: crewDocs[i]._id,
      project_id: projects[1]._id,
      acceptanceStatus: "accepted",
      contract_title: "Gulf Seabed Survey Contract",
      contract_body: "Technician role service contract for marine drilling exploration.",
      contract_signed_at: project2From,
      contract_end_date: project2To,
    });
  }
  invitesData.push({
    crew_id: crewDocs[7]._id,
    project_id: projects[1]._id,
    acceptanceStatus: "pending",
    contract_title: "Gulf Seabed Survey Contract",
    contract_body: "Technician role service contract for marine drilling exploration.",
  });

  // Project 3: Onhold, 2 pending, 1 rejected, 1 accepted
  invitesData.push(
    {
      crew_id: crewDocs[8]._id,
      project_id: projects[2]._id,
      acceptanceStatus: "pending",
      contract_title: "Atlantic Safety Maintenance Contract",
      contract_body: "Standard maintenance technician crew contract.",
    },
    {
      crew_id: crewDocs[9]._id,
      project_id: projects[2]._id,
      acceptanceStatus: "pending",
      contract_title: "Atlantic Safety Maintenance Contract",
      contract_body: "Standard maintenance technician crew contract.",
    },
    {
      crew_id: crewDocs[10]._id,
      project_id: projects[2]._id,
      acceptanceStatus: "rejected",
      contract_title: "Atlantic Safety Maintenance Contract",
      contract_body: "Standard maintenance technician crew contract.",
    },
    {
      crew_id: crewDocs[11]._id,
      project_id: projects[2]._id,
      acceptanceStatus: "accepted",
      contract_title: "Atlantic Safety Maintenance Contract",
      contract_body: "Standard maintenance technician crew contract.",
      contract_signed_at: new Date(),
      contract_end_date: project3To,
    }
  );

  await CrewInvite.insertMany(invitesData);
  console.log("Seeded project invites and contracts.");

  // 8. Seed Timesheets
  console.log("Seeding Timesheets...");
  const timesheetDocs = [];

  // Seed daily entries for Project 1 participants (started 25 days ago)
  for (let i = 0; i < 4; i++) {
    const entries = [];
    const startDate = new Date(project1From);
    const today = new Date();

    while (startDate <= today) {
      // randomly present (90%), sick leave (5%), or absent (5%)
      const rand = Math.random();
      let status = "PRESENT";
      if (rand > 0.95) status = "ABSENT";
      else if (rand > 0.90) status = "LEAVE";

      entries.push({
        date: new Date(startDate),
        status,
      });

      // Increment by 1 day
      startDate.setDate(startDate.getDate() + 1);
    }

    timesheetDocs.push({
      crew_id: crewDocs[i]._id,
      project_id: projects[0]._id,
      entries,
    });
  }

  // Seed daily entries for Project 2 participants (started 10 days ago)
  for (let i = 4; i < 7; i++) {
    const entries = [];
    const startDate = new Date(project2From);
    const today = new Date();

    while (startDate <= today) {
      const rand = Math.random();
      let status = "PRESENT";
      if (rand > 0.95) status = "ABSENT";
      else if (rand > 0.90) status = "LEAVE";

      entries.push({
        date: new Date(startDate),
        status,
      });
      startDate.setDate(startDate.getDate() + 1);
    }

    timesheetDocs.push({
      crew_id: crewDocs[i]._id,
      project_id: projects[1]._id,
      entries,
    });
  }

  await Timesheet.insertMany(timesheetDocs);
  console.log("Seeded timesheet entries.");

  // 9. Seed Payroll Settings
  console.log("Seeding Payroll records...");
  const payrolls = [];
  // Project 1
  for (let i = 0; i < 4; i++) {
    payrolls.push({
      crew_id: crewDocs[i]._id,
      project_id: projects[0]._id,
      rate_type: i % 2 === 0 ? "per_day" : "per_hour",
      pay_amount: i % 2 === 0 ? 350 : 45,
      createdBy: adminDoc._id,
    });
  }
  // Project 2
  for (let i = 4; i < 7; i++) {
    payrolls.push({
      crew_id: crewDocs[i]._id,
      project_id: projects[1]._id,
      rate_type: "per_day",
      pay_amount: 400,
      createdBy: adminDoc._id,
    });
  }
  await Payroll.insertMany(payrolls);
  console.log("Seeded payroll settings.");

  // 10. Seed Crew Tickets & Invoices
  console.log("Seeding Crew Tickets & Flight snapshot details...");
  
  // Let's build a couple of tickets for our active projects
  const ticket1 = await CrewTicket.create({
    crew_id: crewDocs[0]._id,
    project_id: projects[0]._id,
    createdBy: adminDoc._id,
    rig_id: rigs[0]._id,
    from: { Name: "Aberdeen Airport (ABZ)", COUNTRY: "UK", COUNTRYNAME: "United Kingdom" },
    to: { Name: "Baku Heydar Aliyev Airport (GYD)", COUNTRY: "AZ", COUNTRYNAME: "Azerbaijan" },
    class: "ECONOMY",
    adult: 1,
    children: 0,
    infants: 0,
    trip: "ROUND_TRIP",
    status: "APPROVED",
    bookingReference: "BAK9876Q",
    approvedAt: new Date(project1From),
    approvedBy: superadminDoc._id,
    markup: 150,
    balance: 150,
    price: 850,
    cashback: 25,
    travelStart: project1From,
    travelEnd: project1To,
    pdf: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
    flightSnapshot: {
      airlineName: "British Airways",
      airlineCode: "BA",
      legs: [
        {
          from: "ABZ",
          to: "GYD",
          departureTime: "2026-06-01T08:00:00Z",
          arrivalTime: "2026-06-01T15:30:00Z",
          duration: "7h 30m",
          airlineName: "British Airways",
          airlineCode: "BA",
          itinerary: [
            {
              airlineName: "British Airways",
              airlineCode: "BA",
              flightNumber: "BA1306",
              from: "ABZ",
              to: "LHR",
              departureTime: "2026-06-01T08:00:00Z",
              arrivalTime: "2026-06-01T09:30:00Z",
              cabin: "ECONOMY",
              baggage: "23kg",
            },
            {
              airlineName: "British Airways",
              airlineCode: "BA",
              flightNumber: "BA144",
              from: "LHR",
              to: "GYD",
              departureTime: "2026-06-01T11:00:00Z",
              arrivalTime: "2026-06-01T15:30:00Z",
              cabin: "ECONOMY",
              baggage: "23kg",
            }
          ]
        }
      ],
      fares: [{ totalFare: 850, cabin: "ECONOMY", name: "Standard Economy" }],
      currency: "GBP",
    }
  });

  const ticket2 = await CrewTicket.create({
    crew_id: crewDocs[4]._id,
    project_id: projects[1]._id,
    createdBy: adminDoc._id,
    rig_id: rigs[1]._id,
    from: { Name: "Houston George Bush Intercontinental (IAH)", COUNTRY: "US", COUNTRYNAME: "United States" },
    to: { Name: "Oslo Gardermoen (OSL)", COUNTRY: "NO", COUNTRYNAME: "Norway" },
    class: "BUSINESS",
    adult: 1,
    children: 0,
    infants: 0,
    trip: "ONE_WAY",
    status: "UNAPPROVED",
    markup: 250,
    balance: 250,
    price: 3200,
    cashback: 50,
    travelStart: project2From,
    travelEnd: project2From,
    flightSnapshot: {
      airlineName: "Scandinavian Airlines",
      airlineCode: "SK",
      legs: [
        {
          from: "IAH",
          to: "OSL",
          departureTime: "2026-06-15T15:00:00Z",
          arrivalTime: "2026-06-16T09:00:00Z",
          duration: "11h 00m",
          airlineName: "Scandinavian Airlines",
          airlineCode: "SK",
          itinerary: [
            {
              airlineName: "Scandinavian Airlines",
              airlineCode: "SK",
              flightNumber: "SK954",
              from: "IAH",
              to: "CPH",
              departureTime: "2026-06-15T15:00:00Z",
              arrivalTime: "2026-06-16T07:30:00Z",
              cabin: "BUSINESS",
              baggage: "32kg",
            },
            {
              airlineName: "Scandinavian Airlines",
              airlineCode: "SK",
              flightNumber: "SK1462",
              from: "CPH",
              to: "OSL",
              departureTime: "2026-06-16T08:15:00Z",
              arrivalTime: "2026-06-16T09:00:00Z",
              cabin: "BUSINESS",
              baggage: "32kg",
            }
          ]
        }
      ],
      fares: [{ totalFare: 3200, cabin: "BUSINESS", name: "SAS Business" }],
      currency: "GBP",
    }
  });

  // Seed invoices
  await AdminInvoice.create({
    ticketId: ticket1._id,
    projectId: projects[0]._id,
    invoiceNumber: "INV-2026-0001",
    margin: 150,
    total: 1000, // Price 850 + Markup 150
    pdf: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
    status: "SENT",
    sentAt: new Date(project1From),
  });

  await AdminInvoice.create({
    ticketId: ticket2._id,
    projectId: projects[1]._id,
    invoiceNumber: null,
    margin: null,
    total: null,
    pdf: null,
    status: "DRAFT",
  });

  console.log("Seeded crew tickets and invoices successfully.");

  console.log("\n=======================================================");
  console.log("SEEDING COMPLETED SUCCESSFULLY.");
  console.log("Database contains complete interconnected records:");
  console.log(`- SuperAdmin: superadmin@yopmail.com  (Password: ${PASSWORD_PLAIN})`);
  console.log(`- Admin:      marine-admin@yopmail.com       (Password: ${PASSWORD_PLAIN})`);
  console.log(`- Crew:       crew1@a.com to crew12@a.com (Password: ${PASSWORD_PLAIN})`);
  console.log(`- Projects:   ${projects.length} Active / OnHold Projects`);
  console.log(`- Rigs:       ${rigs.length} Active Drilling Rigs`);
  console.log("- Includes:   Timesheets, Payrolls, Invites, Availabilities, Tickets, and Invoices.");
  console.log("=======================================================\n");

  mongoose.connection.close();
}

seed().catch((err) => {
  console.error("Seeding failed with error:", err);
  mongoose.connection.close();
  process.exit(1);
});
