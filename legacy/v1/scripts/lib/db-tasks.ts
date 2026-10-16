// Database tasks shared by the CLI scripts (init, seed, create-admin, bootstrap).
// Runs outside Next.js via tsx, so it uses relative imports only.
import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import postgres from "postgres";
import dotenv from "dotenv";
import {
  addDaysToDateString,
  dayOfWeekFromDateString,
  minutesToTime,
  todayInTimeZone,
  zonedTimeToUtc,
} from "../../lib/time";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

export type Sql = ReturnType<typeof postgres>;

const BCRYPT_ROUNDS = 12;

export function connect(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env.local or the environment.");
    process.exit(1);
  }
  return postgres(url, {
    ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
    max: 1,
    onnotice: () => {},
  });
}

/** Applies scripts/init-db.sql. Idempotent. */
export async function applySchema(sql: Sql) {
  const sqlPath = path.join(process.cwd(), "scripts", "init-db.sql");
  await sql.unsafe(fs.readFileSync(sqlPath, "utf-8"));
  console.log("✓ Schema is up to date");
}

async function userCount(sql: Sql): Promise<number> {
  const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM medflow.users`;
  return row.count;
}

/** Creates an admin account unless one with that email already exists. */
export async function ensureAdmin(
  sql: Sql,
  input: { email: string; password: string; firstName?: string; lastName?: string },
) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Admin email is invalid");
  if (input.password.length < 12) throw new Error("Admin password must be at least 12 characters");

  const existing = await sql`SELECT id, role FROM medflow.users WHERE lower(email) = ${email}`;
  if (existing.length > 0) {
    console.log(`✓ Account ${email} already exists (role: ${existing[0].role}); left unchanged`);
    return;
  }

  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  await sql`
    INSERT INTO medflow.users (email, password_hash, role, first_name, last_name)
    VALUES (${email}, ${hash}, 'admin', ${input.firstName ?? "System"}, ${input.lastName ?? "Administrator"})
  `;
  console.log(`✓ Created admin account ${email}`);
}

/**
 * Loads demo data. Refuses to touch a database that already has users unless
 * `reset` is set, in which case ALL existing data is deleted first.
 */
export async function seedDemoData(sql: Sql, { reset }: { reset: boolean }) {
  const existing = await userCount(sql);

  if (existing > 0 && !reset) {
    console.log(`• Database already has ${existing} user(s); skipping demo seed (use --reset to wipe and reseed)`);
    return;
  }

  if (reset) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && process.env.ALLOW_DESTRUCTIVE_SEED !== "true") {
      throw new Error(
        "Refusing to wipe a production database. Set ALLOW_DESTRUCTIVE_SEED=true if you really mean it.",
      );
    }
    console.log("! Deleting all existing data...");
  }

  const timeZone = process.env.CLINIC_TIMEZONE || "Asia/Kolkata";

  await sql.begin(async (transaction) => {
    // postgres.js types drop the call signature on TransactionSql; it is callable at runtime.
    const tx = transaction as unknown as Sql;

    if (reset) {
      await tx`DELETE FROM medflow.audit_logs`;
      await tx`DELETE FROM medflow.appointments`;
      await tx`DELETE FROM medflow.doctor_availability`;
      await tx`DELETE FROM medflow.patients`;
      await tx`DELETE FROM medflow.doctors`;
      await tx`DELETE FROM medflow.departments`;
      await tx`DELETE FROM medflow.users`;
    }

    const [adminHash, doctorHash, patientHash] = await Promise.all([
      bcrypt.hash("admin123", BCRYPT_ROUNDS),
      bcrypt.hash("doctor123", BCRYPT_ROUNDS),
      bcrypt.hash("patient123", BCRYPT_ROUNDS),
    ]);

    await tx`
      INSERT INTO medflow.users (email, password_hash, role, first_name, last_name)
      VALUES ('admin@medflow.com', ${adminHash}, 'admin', 'System', 'Administrator')
    `;

    const departmentsData = [
      { name: "Cardiology", description: "Heart, vascular health, and cardiovascular care" },
      { name: "Neurology", description: "Brain, spinal cord, and central nervous system specialties" },
      { name: "Pediatrics", description: "Comprehensive healthcare for infants, children, and teens" },
      { name: "Orthopedics", description: "Bone, joint, spine, and musculoskeletal medical care" },
      { name: "Dermatology", description: "Skin, hair, and nail health and cosmetic care" },
      { name: "Oncology", description: "Advanced cancer diagnosis, therapy, and patient care" },
      { name: "General Medicine", description: "Primary care, health screenings, and internal medicine" },
    ];

    const departmentIds = new Map<string, string>();
    for (const dep of departmentsData) {
      const [row] = await tx`
        INSERT INTO medflow.departments (name, description)
        VALUES (${dep.name}, ${dep.description})
        RETURNING id
      `;
      departmentIds.set(dep.name, row.id);
    }

    const doctorsData = [
      { firstName: "Robert", lastName: "Chen", email: "dr.chen@medflow.com", dept: "Cardiology", spec: "Cardiologist", lic: "MD-10021", exp: 14 },
      { firstName: "Sarah", lastName: "Jenkins", email: "dr.jenkins@medflow.com", dept: "Cardiology", spec: "Cardiologist", lic: "MD-10022", exp: 10 },
      { firstName: "Michael", lastName: "Ross", email: "dr.ross@medflow.com", dept: "Cardiology", spec: "Cardiologist", lic: "MD-10023", exp: 18 },
      { firstName: "Elena", lastName: "Rostova", email: "dr.rostova@medflow.com", dept: "Neurology", spec: "Neurologist", lic: "MD-10024", exp: 12 },
      { firstName: "James", lastName: "Wilson", email: "dr.wilson@medflow.com", dept: "Neurology", spec: "Neurologist", lic: "MD-10025", exp: 15 },
      { firstName: "Maya", lastName: "Patel", email: "dr.patel@medflow.com", dept: "Neurology", spec: "Neurologist", lic: "MD-10026", exp: 8 },
      { firstName: "Emily", lastName: "Thorne", email: "dr.thorne@medflow.com", dept: "Pediatrics", spec: "Pediatrician", lic: "MD-10027", exp: 9 },
      { firstName: "David", lastName: "Kim", email: "dr.kim@medflow.com", dept: "Pediatrics", spec: "Pediatrician", lic: "MD-10028", exp: 11 },
      { firstName: "Lisa", lastName: "Al-Mansoor", email: "dr.almansoor@medflow.com", dept: "Pediatrics", spec: "Pediatrician", lic: "MD-10029", exp: 16 },
      { firstName: "Marcus", lastName: "Vance", email: "dr.vance@medflow.com", dept: "Orthopedics", spec: "Orthopedic", lic: "MD-10030", exp: 13 },
      { firstName: "Olivia", lastName: "Taylor", email: "dr.taylor@medflow.com", dept: "Orthopedics", spec: "Orthopedic", lic: "MD-10031", exp: 20 },
      { firstName: "Benjamin", lastName: "Hayes", email: "dr.hayes@medflow.com", dept: "Orthopedics", spec: "Orthopedic", lic: "MD-10032", exp: 17 },
      { firstName: "Sophia", lastName: "Martinez", email: "dr.martinez@medflow.com", dept: "Dermatology", spec: "Dermatologist", lic: "MD-10033", exp: 7 },
      { firstName: "Alexander", lastName: "Wright", email: "dr.wright@medflow.com", dept: "Dermatology", spec: "Dermatologist", lic: "MD-10034", exp: 14 },
      { firstName: "Chloe", lastName: "Bennett", email: "dr.bennett@medflow.com", dept: "Dermatology", spec: "Dermatologist", lic: "MD-10035", exp: 9 },
      { firstName: "Jonathan", lastName: "Reed", email: "dr.reed@medflow.com", dept: "Oncology", spec: "General Physician", lic: "MD-10036", exp: 22 },
      { firstName: "Grace", lastName: "Morgan", email: "dr.morgan@medflow.com", dept: "Oncology", spec: "Radiologist", lic: "MD-10037", exp: 13 },
      { firstName: "Daniel", lastName: "Gupta", email: "dr.gupta@medflow.com", dept: "Oncology", spec: "Radiologist", lic: "MD-10038", exp: 11 },
      { firstName: "Hannah", lastName: "Abbott", email: "dr.abbott@medflow.com", dept: "General Medicine", spec: "General Physician", lic: "MD-10039", exp: 15 },
      { firstName: "Christopher", lastName: "Lee", email: "dr.lee@medflow.com", dept: "General Medicine", spec: "General Physician", lic: "MD-10040", exp: 12 },
      { firstName: "Victoria", lastName: "Sterling", email: "dr.sterling@medflow.com", dept: "General Medicine", spec: "ENT Specialist", lic: "MD-10041", exp: 19 },
    ];

    const doctorIds: string[] = [];
    for (const doc of doctorsData) {
      const [user] = await tx`
        INSERT INTO medflow.users (email, password_hash, role, first_name, last_name)
        VALUES (${doc.email}, ${doctorHash}, 'doctor', ${doc.firstName}, ${doc.lastName})
        RETURNING id
      `;
      const [doctor] = await tx`
        INSERT INTO medflow.doctors (user_id, specialization, license_number, years_of_experience, department_id)
        VALUES (${user.id}, ${doc.spec}, ${doc.lic}, ${doc.exp}, ${departmentIds.get(doc.dept)!})
        RETURNING id
      `;
      doctorIds.push(doctor.id);

      // Monday-Friday, 09:00-17:00 clinic time
      for (let day = 1; day <= 5; day++) {
        await tx`
          INSERT INTO medflow.doctor_availability (doctor_id, day_of_week, start_time, end_time)
          VALUES (${doctor.id}, ${day}, '09:00', '17:00')
        `;
      }
    }

    const patientsData = [
      { firstName: "John", lastName: "Doe", email: "john.doe@gmail.com", gender: "male", contact: "+1-555-0101", address: "123 Maple St, New York, NY" },
      { firstName: "Jane", lastName: "Smith", email: "jane.smith@gmail.com", gender: "female", contact: "+1-555-0102", address: "456 Oak Ave, Los Angeles, CA" },
      { firstName: "Alice", lastName: "Johnson", email: "alice.j@gmail.com", gender: "female", contact: "+1-555-0103", address: "789 Pine Rd, Austin, TX" },
      { firstName: "Bob", lastName: "Brown", email: "bob.brown@yahoo.com", gender: "male", contact: "+1-555-0104", address: "321 Cedar Blvd, Miami, FL" },
      { firstName: "Charlie", lastName: "Davis", email: "charlie.d@gmail.com", gender: "male", contact: "+1-555-0105", address: "654 Elm St, Seattle, WA" },
      { firstName: "Diana", lastName: "Prince", email: "diana.p@outlook.com", gender: "female", contact: "+1-555-0106", address: "987 Birch Ln, Chicago, IL" },
      { firstName: "Evan", lastName: "Wright", email: "evan.w@gmail.com", gender: "male", contact: "+1-555-0107", address: "147 Walnut St, Boston, MA" },
      { firstName: "Fiona", lastName: "Gallagher", email: "fiona.g@yahoo.com", gender: "female", contact: "+1-555-0108", address: "258 Spruce Ct, Philadelphia, PA" },
      { firstName: "George", lastName: "Clark", email: "george.c@gmail.com", gender: "male", contact: "+1-555-0109", address: "369 Ash Ave, Columbus, OH" },
      { firstName: "Hannah", lastName: "Montana", email: "hannah.m@gmail.com", gender: "female", contact: "+1-555-0110", address: "741 Chestnut Dr, Charlotte, NC" },
      { firstName: "Ian", lastName: "Malcolm", email: "ian.m@gmail.com", gender: "male", contact: "+1-555-0111", address: "852 Cypress Way, Atlanta, GA" },
      { firstName: "Julia", lastName: "Roberts", email: "julia.r@hotmail.com", gender: "female", contact: "+1-555-0112", address: "963 Magnolia Dr, Detroit, MI" },
      { firstName: "Kevin", lastName: "Bacon", email: "kevin.b@gmail.com", gender: "male", contact: "+1-555-0113", address: "159 Poplar St, Denver, CO" },
      { firstName: "Laura", lastName: "Croft", email: "laura.c@gmail.com", gender: "female", contact: "+1-555-0114", address: "357 Redwood Hwy, Portland, OR" },
      { firstName: "Matthew", lastName: "Murdock", email: "matt.m@gmail.com", gender: "male", contact: "+1-555-0115", address: "468 Sycamore Ln, New York, NY" },
      { firstName: "Natasha", lastName: "Romanoff", email: "natasha.r@gmail.com", gender: "female", contact: "+1-555-0116", address: "579 Willow Way, Las Vegas, NV" },
      { firstName: "Oscar", lastName: "Isaac", email: "oscar.i@gmail.com", gender: "male", contact: "+1-555-0117", address: "680 Alder Ct, Phoenix, AZ" },
      { firstName: "Penelope", lastName: "Cruz", email: "penelope.c@gmail.com", gender: "female", contact: "+1-555-0118", address: "791 Beech Rd, Santa Fe, NM" },
      { firstName: "Quentin", lastName: "Tarantino", email: "quentin.t@gmail.com", gender: "male", contact: "+1-555-0119", address: "802 Hickory St, Nashville, TN" },
      { firstName: "Rachel", lastName: "Green", email: "rachel.g@gmail.com", gender: "female", contact: "+1-555-0120", address: "913 Olive Ave, New York, NY" },
    ];

    const patientIds: string[] = [];
    for (const pat of patientsData) {
      const [user] = await tx`
        INSERT INTO medflow.users (email, password_hash, role, first_name, last_name)
        VALUES (${pat.email}, ${patientHash}, 'patient', ${pat.firstName}, ${pat.lastName})
        RETURNING id
      `;
      const [patient] = await tx`
        INSERT INTO medflow.patients (user_id, first_name, last_name, gender, contact_number, address)
        VALUES (${user.id}, ${pat.firstName}, ${pat.lastName}, ${pat.gender}, ${pat.contact}, ${pat.address})
        RETURNING id
      `;
      patientIds.push(patient.id);
    }

    const sampleNotes = [
      "Routine annual health evaluation and blood test review.",
      "Persistent chest discomfort and blood pressure monitoring.",
      "Pediatric vaccination checkup and growth tracking.",
      "Post-operative joint follow-up and physical therapy guidance.",
      "Dermatology consultation for skin rash and allergy assessment.",
      "Oncology consultation and lab results discussion.",
      "General wellness screening and lifestyle consultation.",
      "Follow-up visit for ongoing medication adjustment.",
    ];

    // 30 appointments spread from 5 days ago to 5 days ahead, on working days
    // and at slot-aligned clinic-local times, so they match real bookings.
    const today = todayInTimeZone(timeZone);
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      let date = addDaysToDateString(today, (i % 11) - 5);
      const dow = dayOfWeekFromDateString(date);
      if (dow === 6) date = addDaysToDateString(date, 2);
      if (dow === 0) date = addDaysToDateString(date, 1);

      const startsAt = zonedTimeToUtc(date, minutesToTime((9 + (i % 7)) * 60), timeZone);
      const isPast = startsAt.getTime() < now;
      const status = isPast
        ? (["completed", "completed", "cancelled"] as const)[i % 3]
        : (["pending", "confirmed"] as const)[i % 2];

      await tx`
        INSERT INTO medflow.appointments (patient_id, doctor_id, appointment_datetime, notes, status)
        VALUES (${patientIds[i % patientIds.length]}, ${doctorIds[i % doctorIds.length]},
                ${startsAt.toISOString()}::timestamptz, ${sampleNotes[i % sampleNotes.length]}, ${status})
        ON CONFLICT DO NOTHING
      `;
    }
  });

  console.log("✓ Demo data loaded");
  console.log("  Admin:    admin@medflow.com / admin123");
  console.log("  Doctor:   dr.chen@medflow.com / doctor123  (21 doctors)");
  console.log("  Patient:  john.doe@gmail.com / patient123  (20 patients)");
  console.log("  These are public demo credentials - never seed them into a real deployment.");
}
