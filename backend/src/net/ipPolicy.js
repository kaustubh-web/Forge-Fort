import ipaddr from "ipaddr.js";
import { isIP } from "node:net";

// Which IP addresses the HTTP node may connect to (SSRF protection, docs/decisions/ssrf.md).
//
// Allow-list, not block-list: an address is allowed only if ipaddr.js classifies it as
// "unicast", which means an ordinary public address. Everything else is refused, including:
//   loopback          127.0.0.0/8, ::1
//   private           10/8, 172.16/12, 192.168/16
//   linkLocal         169.254/16 (cloud metadata 169.254.169.254), fe80::/10
//   carrierGradeNat   100.64/10 (Alibaba metadata 100.100.100.200)
//   uniqueLocal       fc00::/7 (AWS IPv6 metadata fd00:ec2::254)
//   unspecified, broadcast, multicast, reserved, and the IPv6 tunnelling ranges
//   (6to4, teredo, NAT64 rfc6052) that can wrap a private IPv4 address.
// A block-list fails open when we forget a range; an allow-list fails closed.
//
// Parsing IPs is the tricky part (::ffff:7f00:1 is 127.0.0.1), so it is left to ipaddr.js.
export function isPublicAddress(address) {
    if (!isIP(address)) return false; // only canonical IP strings, never hostnames or "2130706433"

    let parsed = ipaddr.parse(address);
    // ::ffff:a.b.c.d is an IPv4 address in IPv6 clothing: judge the IPv4 address inside.
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();

    return parsed.range() === "unicast";
}
