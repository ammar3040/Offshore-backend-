import dns from "dns";
import mongoose from "mongoose";
import { ensureAdminInvoiceIndexes } from "./models/adminInvoice.model";
import { ensureCrewTicketIndexes } from "./models/crewTicket.model";

// const DEFAULT_URI = "mongodb://127.0.0.1:27017/marine-flight-backend";

async function resolveSrvToStandardUri(srvUri: string): Promise<string> {
  const parsedUrl = new URL(srvUri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
  const username = encodeURIComponent(parsedUrl.username);
  const password = encodeURIComponent(parsedUrl.password);
  const host = parsedUrl.hostname;
  const pathname = parsedUrl.pathname;
  const originalSearchParams = parsedUrl.searchParams;

  // Query SRV record via DNS-over-HTTPS (DoH)
  let srvData: any;
  try {
    const srvRes = await globalThis.fetch(`https://dns.google/resolve?name=_mongodb._tcp.${host}&type=SRV`);
    srvData = await srvRes.json();
  } catch (err) {
    const srvRes = await globalThis.fetch(`https://cloudflare-dns.com/dns-query?name=_mongodb._tcp.${host}&type=SRV`, {
      headers: { Accept: "application/dns-json" }
    });
    srvData = await srvRes.json();
  }

  if (!srvData.Answer || srvData.Answer.length === 0) {
    throw new Error(`Failed to resolve SRV record for ${host}`);
  }

  const hosts = srvData.Answer.map((ans: any) => {
    const parts = ans.data.trim().split(/\s+/);
    const port = parts[2];
    const target = parts[3].replace(/\.$/, "");
    return `${target}:${port}`;
  });

  // Query TXT record via DNS-over-HTTPS (DoH)
  let txtData: any;
  try {
    const txtRes = await globalThis.fetch(`https://dns.google/resolve?name=${host}&type=TXT`);
    txtData = await txtRes.json();
  } catch (err) {
    const txtRes = await globalThis.fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=TXT`, {
      headers: { Accept: "application/dns-json" }
    });
    txtData = await txtRes.json();
  }

  let txtOptions = "";
  if (txtData.Answer && txtData.Answer.length > 0) {
    txtOptions = txtData.Answer[0].data.replace(/^"|"$/g, "");
  }

  // Merge options
  const finalParams = new URLSearchParams(txtOptions);
  finalParams.set("ssl", "true");
  for (const [key, val] of originalSearchParams.entries()) {
    finalParams.set(key, val);
  }

  return `mongodb://${username}:${password}@${hosts.join(",")}${pathname}?${finalParams.toString()}`;
}

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI environment variable is not set.");
  }

  if (mongoose.connection.readyState === 1) {
    return;
  }

  try {
    await mongoose.connect(uri);
    // eslint-disable-next-line no-console
    console.log("Connected to MongoDB");
    await ensureCrewTicketIndexes();
    await ensureAdminInvoiceIndexes();
  } catch (error: any) {
    // If MongoDB Atlas DNS lookup or TXT query times out/fails, retry using DoH or custom DNS fallback.
    if (
      uri.startsWith("mongodb+srv://") &&
      (error.code === "ETIMEOUT" || 
       error.message?.includes("ENOTFOUND") || 
       error.message?.includes("ETIMEOUT") ||
       error.message?.includes("queryTxt"))
    ) {
      // eslint-disable-next-line no-console
      console.warn("MongoDB connection timed out or DNS resolution failed. Attempting dynamic resolution using DNS-over-HTTPS...");
      try {
        const resolvedUri = await resolveSrvToStandardUri(uri);
        await mongoose.connect(resolvedUri);
        // eslint-disable-next-line no-console
        console.log("Connected to MongoDB using dynamically resolved connection string");
        await ensureCrewTicketIndexes();
        await ensureAdminInvoiceIndexes();
        return;
      } catch (dohError) {
        // eslint-disable-next-line no-console
        console.warn("DNS-over-HTTPS resolution failed. Falling back to overriding Node's DNS servers...", dohError);
        try {
          dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
          await mongoose.connect(uri);
          // eslint-disable-next-line no-console
          console.log("Connected to MongoDB using overridden DNS servers");
          await ensureCrewTicketIndexes();
          await ensureAdminInvoiceIndexes();
          return;
        } catch (retryError) {
          // eslint-disable-next-line no-console
          console.error("Failed to connect to MongoDB even with fallback methods:", retryError);
          throw retryError;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.error("Failed to connect to MongoDB:", error);
    throw error;
  }
}

