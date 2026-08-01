import { z } from "zod";
import { asBusinessDate } from "../dates.js";
import { parse as parseMoney } from "../money.js";

/**
 * The two wire shapes every resource schema is built from (IG §1.5, §4.4,
 * §4.5): money crosses as a decimal string and parses straight to `Minor`,
 * a business date crosses as `YYYY-MM-DD` and parses straight to
 * `BusinessDate` — so a schema that uses these never re-introduces `number`
 * or a bare `Date` one call site at a time.
 */
export const moneyWireSchema = z
  .string()
  .regex(/^-?\d+$/, "Not a money value — whole minor units as a decimal string")
  .transform(parseMoney);

export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Not a business date — expected YYYY-MM-DD")
  .transform(asBusinessDate);

export const uuidSchema = z.string().uuid();
