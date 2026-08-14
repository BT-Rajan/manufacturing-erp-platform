import { z } from "zod";

export const userCreateSchema = z.object({
  username: z.string().min(1).max(50),
  email: z.string().email().max(120),
  password: z.string().min(8).max(255),
  full_name: z.string().min(1).max(120),
  phone: z.string().max(30).nullish(),
  department: z.enum(["sales", "procurement", "warehouse"]).nullish(),
  role: z.enum(["admin", "manager", "staff", "viewer"]).default("staff"),
  is_active: z.boolean().default(true),
});

export const userUpdateSchema = z.object({
  email: z.string().email().max(120).optional(),
  password: z.string().min(8).max(255).optional(),
  full_name: z.string().min(1).max(120).optional(),
  phone: z.string().max(30).nullish(),
  department: z.enum(["sales", "procurement", "warehouse"]).nullish(),
  role: z.enum(["admin", "manager", "staff", "viewer"]).optional(),
  is_active: z.boolean().optional(),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
