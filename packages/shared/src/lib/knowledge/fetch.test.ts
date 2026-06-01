import { describe, expect, it } from "vitest"

import { isPrivateIp } from "./fetch"

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
  ])("refuses %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "192.169.0.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
  ])("allows public %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })
})
