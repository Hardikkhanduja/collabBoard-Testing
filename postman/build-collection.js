// Run: node postman/build-collection.js  -> writes the Postman collection (+ environment file the first time)
const fs = require("fs");
const T = (code) =>
  `pm.test("status is ${code}", () => pm.response.to.have.status(${code}));`;

// [name, method, path, expected-status, extra test line, body, send token?]
const rows = [
  [
    "TC-API-01 Health check",
    "GET",
    "/health",
    200,
    'pm.expect(pm.response.json().status).to.eql("ok");',
    null,
    false,
  ],
  ["TC-API-02 No token -> 401", "GET", "/api/rooms", 401, "", null, false],
  [
    "TC-API-03 Create room -> 201",
    "POST",
    "/api/rooms",
    201,
    'pm.collectionVariables.set("roomId", pm.response.json().room.id); pm.collectionVariables.set("inviteCode", pm.response.json().inviteCode);',
    { name: "Postman Board" },
    true,
  ],
  [
    "TC-API-04 Empty name -> 400",
    "POST",
    "/api/rooms",
    400,
    "",
    { name: "" },
    true,
  ],
  [
    "TC-API-05 Join by invite code",
    "GET",
    "/api/rooms/join/{{inviteCode}}",
    200,
    "",
    null,
    true,
  ],
  [
    "TC-API-06 Bogus invite code -> 404",
    "GET",
    "/api/rooms/join/NOT-A-REAL-CODE",
    404,
    "",
    null,
    true,
  ],
  [
    "TC-API-07 Rename room",
    "PATCH",
    "/api/rooms/{{roomId}}",
    200,
    "",
    { name: "Renamed" },
    true,
  ],
  [
    "TC-API-08 Delete room -> 204",
    "DELETE",
    "/api/rooms/{{roomId}}",
    204,
    "",
    null,
    true,
  ],
];

const item = ([name, method, path, code, extra, body, auth]) => ({
  name,
  event: [
    {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [T(code), extra].filter(Boolean),
      },
    },
  ],
  request: {
    method,
    header: [
      ...(auth ? [{ key: "Authorization", value: "Bearer {{token}}" }] : []),
      { key: "Content-Type", value: "application/json" },
    ],
    ...(body && { body: { mode: "raw", raw: JSON.stringify(body) } }),
    url: "{{baseUrl}}" + path,
  },
});

// Clerk tokens last ~60s, so fetch a fresh one before every request.
const getToken = `pm.sendRequest({
  url: 'https://api.clerk.com/v1/sessions/' + pm.environment.get('sessionId') + '/tokens',
  method: 'POST',
  header: { Authorization: 'Bearer ' + pm.environment.get('clerkSecretKey'), 'Content-Type': 'application/json' },
  body: { mode: 'raw', raw: '{}' }
}, (err, res) => pm.collectionVariables.set('token', res.json().jwt));`;

const collection = {
  info: {
    name: "CollabBoard API Tests",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  event: [
    {
      listen: "prerequest",
      script: { type: "text/javascript", exec: [getToken] },
    },
  ],
  item: rows.map(item),
};
const env = {
  name: "CollabBoard Live",
  values: [
    { key: "baseUrl", value: "https://collabboard-7xlz.onrender.com" },
    { key: "clerkSecretKey", value: "PASTE_CLERK_SECRET_KEY_HERE" },
    { key: "sessionId", value: "PASTE_SESSION_ID_HERE" },
  ],
};

fs.writeFileSync(
  __dirname + "/collabboard.postman_collection.json",
  JSON.stringify(collection, null, 2),
);
// Only create the environment file the first time, so your pasted secret key is never overwritten.
const envFile = __dirname + "/collabboard.postman_environment.json";
if (!fs.existsSync(envFile))
  fs.writeFileSync(envFile, JSON.stringify(env, null, 2));
console.log("Done: collection written to", __dirname);
