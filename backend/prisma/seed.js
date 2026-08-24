import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPass = await bcrypt.hash("Admin@12345", 10);
  await prisma.user.upsert({
    where: { email: "admin@clinic.local" },
    update: {},
    create: { email: "admin@clinic.local", passwordHash: adminPass, name: "Clinic Admin", role: "ADMIN" },
  });

  const doctorPass = await bcrypt.hash("Doctor@12345", 10);
  const existingDoctor = await prisma.user.findUnique({ where: { email: "dr.smith@clinic.local" } });
  if (!existingDoctor) {
    await prisma.user.create({
      data: {
        email: "dr.smith@clinic.local",
        passwordHash: doctorPass,
        name: "Dr. Smith",
        role: "DOCTOR",
        doctorProfile: {
          create: {
            specialisation: "General Medicine",
            slotDurationMin: 30,
            workingHours: JSON.stringify([
              { day: 1, start: "09:00", end: "17:00" },
              { day: 2, start: "09:00", end: "17:00" },
              { day: 3, start: "09:00", end: "17:00" },
              { day: 4, start: "09:00", end: "17:00" },
              { day: 5, start: "09:00", end: "13:00" },
            ]),
          },
        },
      },
    });
  }

  const patientPass = await bcrypt.hash("Patient@12345", 10);
  await prisma.user.upsert({
    where: { email: "patient@clinic.local" },
    update: {},
    create: { email: "patient@clinic.local", passwordHash: patientPass, name: "Jane Patient", role: "PATIENT" },
  });

  console.log("Seed complete.");
  console.log("Login with: admin@clinic.local / Admin@12345");
  console.log("            dr.smith@clinic.local / Doctor@12345");
  console.log("            patient@clinic.local / Patient@12345");
}

main().finally(() => prisma.$disconnect());
