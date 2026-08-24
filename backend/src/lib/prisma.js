import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance (avoids exhausting DB connections in dev
// with hot-reload, and is the standard pattern for serverless deploys too).
export const prisma = new PrismaClient();
