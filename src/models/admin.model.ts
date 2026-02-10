export interface Admin {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string; // hashed password
  phone: string;
}

// In-memory store for now. Replace with DB later.
const admins: Admin[] = [];

export function findAdminByEmail(email: string): Admin | undefined {
  return admins.find((admin) => admin.email.toLowerCase() === email.toLowerCase());
}

export function createAdmin(data: Omit<Admin, "id">): Admin {
  const admin: Admin = {
    id: (admins.length + 1).toString(),
    ...data,
  };
  admins.push(admin);
  return admin;
}

