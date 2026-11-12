// Sessions and users, straight from Prisma; customers live in Stripe.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function verify(token: string): Promise<boolean> {
  const session = await prisma.session.findFirst({ where: { token } });
  if (!session) return false;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  return !!user;
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  const r = await fetch("https://api.stripe.com/v1/customers", { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  const customers = await r.json();
  return { ...user, customers };
}
