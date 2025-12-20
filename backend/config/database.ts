import { PrismaClient } from '../generated/prisma'

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

export default prisma;
