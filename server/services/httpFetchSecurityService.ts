import { BlockList, isIP } from 'node:net'
import type { HttpFetchFailureCode } from '../types/researchTool'

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export class HttpFetchItemError extends Error {
  constructor(
    public readonly code: HttpFetchFailureCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'HttpFetchItemError'
  }
}

const BLOCKED_HOSTS = new Set([
  'instance-data',
  'instance-data.ec2.internal',
  'metadata',
  'metadata.aws.internal',
  'metadata.azure.internal',
  'metadata.google.internal',
])
const BLOCKED_EXACT_ADDRESSES = new Set([
  // Azure platform virtual IP; it is reachable only from inside Azure guests.
  '168.63.129.16',
])

const BLOCKED_IPV4 = new BlockList()
;[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([network, prefix]) => {
  BLOCKED_IPV4.addSubnet(network as string, prefix as number, 'ipv4')
})

function withoutIpv6Brackets(value: string) {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function normalizeHostname(value: string) {
  return withoutIpv6Brackets(value).replace(/\.+$/, '').toLowerCase()
}

interface NumericAddress {
  family: 4 | 6
  value: bigint
}

interface Ipv6Cidr {
  network: bigint
  prefix: number
}

function addressInput(value: string) {
  return withoutIpv6Brackets(value).split('%', 1)[0]!.toLowerCase()
}

function parseIpv4Value(value: string) {
  if (isIP(value) !== 4) return null
  return value.split('.').reduce(
    (result, part) => (result << 8n) | BigInt(Number.parseInt(part, 10)),
    0n,
  )
}

function parseIpv6Value(value: string) {
  let normalized = addressInput(value)
  if (isIP(normalized) !== 6) return null

  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':')
    const embeddedIpv4 = parseIpv4Value(normalized.slice(separator + 1))
    if (separator < 0 || embeddedIpv4 === null) return null
    const high = Number((embeddedIpv4 >> 16n) & 0xffffn).toString(16)
    const low = Number(embeddedIpv4 & 0xffffn).toString(16)
    normalized = `${normalized.slice(0, separator)}:${high}:${low}`
  }

  const compression = normalized.indexOf('::')
  if (compression !== normalized.lastIndexOf('::')) return null
  const left = compression >= 0
    ? normalized.slice(0, compression).split(':').filter(Boolean)
    : normalized.split(':')
  const right = compression >= 0
    ? normalized.slice(compression + 2).split(':').filter(Boolean)
    : []
  const missing = compression >= 0 ? 8 - left.length - right.length : 0
  if ((compression >= 0 && missing < 1) || (compression < 0 && left.length !== 8)) return null
  const segments = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ]
  if (segments.length !== 8 || segments.some((segment) => !/^[0-9a-f]{1,4}$/.test(segment))) {
    return null
  }
  return segments.reduce(
    (result, segment) => (result << 16n) | BigInt(Number.parseInt(segment, 16)),
    0n,
  )
}

function ipv4String(value: bigint) {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 0xffn))
    .join('.')
}

function mappedIpv4Value(value: bigint) {
  return value >> 32n === 0xffffn ? value & 0xffffffffn : null
}

function mappedIpv4(value: string) {
  const ipv6 = parseIpv6Value(value)
  if (ipv6 === null) return null
  const mapped = mappedIpv4Value(ipv6)
  return mapped === null ? null : ipv4String(mapped)
}

function canonicalAddress(value: string): NumericAddress | null {
  const address = addressInput(value)
  const ipv4 = parseIpv4Value(address)
  if (ipv4 !== null) return { family: 4, value: ipv4 }
  const ipv6 = parseIpv6Value(address)
  if (ipv6 === null) return null
  const mapped = mappedIpv4Value(ipv6)
  return mapped === null
    ? { family: 6, value: ipv6 }
    : { family: 4, value: mapped }
}

function ipv6Cidr(network: string, prefix: number): Ipv6Cidr {
  const parsed = parseIpv6Value(network)
  if (parsed === null || prefix < 0 || prefix > 128) {
    throw new Error(`Invalid internal IPv6 CIDR: ${network}/${prefix}`)
  }
  return { network: parsed, prefix }
}

function isInIpv6Cidr(address: bigint, cidr: Ipv6Cidr) {
  const shift = BigInt(128 - cidr.prefix)
  return address >> shift === cidr.network >> shift
}

// SSRF policy is deliberately narrower than general IPv6 reachability. Only the
// allocated global-unicast block is eligible, and known special-purpose subnets
// inside it remain blocked. Everything unallocated or ambiguous fails closed.
const PUBLIC_IPV6_GLOBAL_UNICAST = ipv6Cidr('2000::', 3)
const BLOCKED_GLOBAL_IPV6 = [
  ipv6Cidr('2001::', 23),
  ipv6Cidr('2001:db8::', 32),
  ipv6Cidr('2002::', 16),
  ipv6Cidr('3fff::', 20),
]

export function isPublicHttpAddress(value: string) {
  const address = canonicalAddress(value)
  if (!address) return false
  if (address.family === 4) {
    const ipv4 = ipv4String(address.value)
    return !BLOCKED_EXACT_ADDRESSES.has(ipv4) && !BLOCKED_IPV4.check(ipv4, 'ipv4')
  }
  return isInIpv6Cidr(address.value, PUBLIC_IPV6_GLOBAL_UNICAST)
    && !BLOCKED_GLOBAL_IPV6.some((cidr) => isInIpv6Cidr(address.value, cidr))
}

export function addressesMatch(expected: string, actual: string) {
  const expectedAddress = canonicalAddress(expected)
  const actualAddress = canonicalAddress(actual)
  return expectedAddress !== null
    && actualAddress !== null
    && expectedAddress.family === actualAddress.family
    && expectedAddress.value === actualAddress.value
}

export function validateHttpFetchUrl(input: string) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new HttpFetchItemError('UNSAFE_URL', 'HTTP fetch URL 无效。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpFetchItemError('UNSUPPORTED_PROTOCOL', 'HTTP fetch 仅支持 http/https。')
  }
  if (url.username || url.password) {
    throw new HttpFetchItemError('UNSAFE_URL', 'HTTP fetch URL 不允许携带用户信息。')
  }
  if (url.port) {
    throw new HttpFetchItemError('UNSAFE_URL', 'HTTP fetch 不允许使用非默认端口。')
  }
  const hostname = normalizeHostname(url.hostname)
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new HttpFetchItemError('UNSAFE_URL', 'HTTP fetch 目标不可访问。')
  }
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.metadata.google.internal')) {
    throw new HttpFetchItemError('PRIVATE_ADDRESS_BLOCKED', 'HTTP fetch 目标不可访问。')
  }
  if (isIP(hostname) > 0 && !isPublicHttpAddress(hostname)) {
    throw new HttpFetchItemError('PRIVATE_ADDRESS_BLOCKED', 'HTTP fetch 地址不可访问。')
  }
  url.hash = ''
  return { url, hostname }
}

export function assertAllResolvedAddressesPublic(addresses: readonly ResolvedAddress[]) {
  if (addresses.length === 0) {
    throw new HttpFetchItemError('DNS_RESOLUTION_FAILED', 'HTTP fetch DNS 未返回地址。')
  }
  if (addresses.some((entry) => (
    (entry.family !== 4 && entry.family !== 6) || !isPublicHttpAddress(entry.address)
  ))) {
    throw new HttpFetchItemError('PRIVATE_ADDRESS_BLOCKED', 'HTTP fetch DNS 返回了受限地址。')
  }
}

export const httpFetchSecurityTestApi = {
  blockedHosts: BLOCKED_HOSTS,
  mappedIpv4,
}
