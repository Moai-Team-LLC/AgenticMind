// Test fixture for tls.test.ts — a TCP endpoint that answers Postgres'
// SSLRequest with 'S' and then speaks TLS with the given key/certificate.
// Runs as its own Node process: Bun cannot upgrade an accepted socket to a
// server-side TLS socket, while the client under test runs on either runtime.
//
//   node fake-tls-postgres.fixture.mjs <key.pem> <cert.pem>
// Prints "listening <port>", then "data <bytes>" for every encrypted chunk.
import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import { TLSSocket } from "node:tls"

const key = readFileSync(process.argv[2], "utf8")
const cert = readFileSync(process.argv[3], "utf8")

const server = createServer((socket) => {
  socket.on("error", () => {
    // The client may drop the socket after a failed handshake — expected.
  })
  socket.once("data", () => {
    socket.write("S")
    const secure = new TLSSocket(socket, { isServer: true, key, cert })
    secure.on("error", () => {
      // A handshake the client rejects ends here.
    })
    secure.on("data", (chunk) => {
      process.stdout.write(`data ${chunk.length}\n`)
      secure.destroy()
    })
  })
})

server.listen(0, () => {
  process.stdout.write(`listening ${server.address().port}\n`)
})
