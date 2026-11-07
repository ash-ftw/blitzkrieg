const API_URL = "http://localhost:4000";

async function run() {
  console.log("1. Logging in as host max@host.com...");
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "max@host.com", password: "host123" })
  });

  if (!loginRes.ok) {
    throw new Error(`Host login failed: ${loginRes.status} ${await loginRes.text()}`);
  }

  const { token, user } = await loginRes.json();
  console.log(`Host logged in successfully! Token: ${token}, Role: ${user.role}`);

  console.log("2. Calling POST /contest/reset (Reset State)...");
  const resetRes = await fetch(`${API_URL}/contest/reset`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!resetRes.ok) {
    throw new Error(`Contest reset failed: ${resetRes.status} ${await resetRes.text()}`);
  }
  console.log("Contest state reset successfully!");

  console.log("3. Verifying host token remains valid after reset...");
  const meRes = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!meRes.ok) {
    throw new Error(`Auth check failed after reset: ${meRes.status} ${await meRes.text()}`);
  }
  const meData = await meRes.json();
  console.log(`Host session intact: ${meData.user.username} (${meData.user.role})`);

  console.log("4. Testing bulk participant email ingestion with same host token...");
  const testEmails = ["student1@college.edu", "student2@college.edu", "student3@college.edu"];
  const ingestRes = await fetch(`${API_URL}/participants/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ emails: testEmails })
  });

  if (!ingestRes.ok) {
    throw new Error(`Ingestion failed: ${ingestRes.status} ${await ingestRes.text()}`);
  }

  const ingestData = await ingestRes.json();
  console.log(`Ingestion succeeded! Added: ${ingestData.added}, Total: ${ingestData.total}`);

  console.log("\nALL VERIFICATION CHECKS PASSED! Host session survives contest reset seamlessly.");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
