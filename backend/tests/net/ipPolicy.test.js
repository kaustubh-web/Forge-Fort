import { describe, it, expect } from "vitest";
import { isPublicAddress } from "../../src/net/ipPolicy.js";

describe("isPublicAddress", () => {
    it.each([
        ["127.0.0.1", "loopback"],
        ["127.255.0.9", "loopback range"],
        ["10.1.2.3", "private 10/8"],
        ["172.16.0.1", "private 172.16/12"],
        ["192.168.1.1", "private 192.168/16"],
        ["169.254.169.254", "cloud metadata (link-local)"],
        ["100.100.100.200", "Alibaba metadata (CGNAT)"],
        ["0.0.0.0", "unspecified"],
        ["255.255.255.255", "broadcast"],
        ["224.0.0.1", "multicast"],
        ["::1", "IPv6 loopback"],
        ["::", "IPv6 unspecified"],
        ["fe80::1", "IPv6 link-local"],
        ["fd00:ec2::254", "AWS IPv6 metadata (unique-local)"],
        ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
        ["::ffff:7f00:1", "IPv4-mapped loopback, hex form"],
        ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
        ["64:ff9b::a00:1", "NAT64 wrapping 10.0.0.1"],
        ["2002:a00:1::", "6to4 wrapping 10.0.0.1"],
        ["localhost", "a hostname, not an IP"],
        ["2130706433", "decimal form, not canonical"],
        ["0x7f.0.0.1", "hex form, not canonical"],
    ])("blocks %s (%s)", (address) => {
        expect(isPublicAddress(address)).toBe(false);
    });

    it.each(["8.8.8.8", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (address) => {
        expect(isPublicAddress(address)).toBe(true);
    });

    it("relies on URL parsing to normalise odd IPv4 forms into ones we can judge", () => {
        expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
        expect(new URL("http://0x7f.1/").hostname).toBe("127.0.0.1");
        expect(isPublicAddress(new URL("http://017700000001/").hostname)).toBe(false);
    });
});
