#!/usr/bin/env bash
# One-time DNS setup: create CNAME for tars.apextech.group
# Requires a Cloudflare API token with Zone:DNS:Edit scope on apextech.group
# 
# The current CLOUDFLARE_API_TOKEN in Infisical (cfat_...) is a Zero Trust token
# that has Tunnel:Edit but NOT Zone:DNS:Edit. Run this with a token that has DNS write access.
#
# Option 1: Use Cloudflare dashboard (30 seconds):
#   Dashboard > apextech.group > DNS > Add Record
#   Type: CNAME
#   Name: tars
#   Content: 19804f4b-4b03-40ad-af2c-2f8a42d55b26.cfargotunnel.com
#   Proxy: ON (orange cloud)
#   Comment: TARS webhook ingress M8

set -eo pipefail

CF_TOKEN=${CLOUDFLARE_DNS_TOKEN:?set CLOUDFLARE_DNS_TOKEN to a token with Zone:DNS:Edit on apextech.group}
ZONE_ID='29ca512ccdb6b0a44f49257c348bc193'
TUNNEL_ID='19804f4b-4b03-40ad-af2c-2f8a42d55b26'

echo 'Creating CNAME tars.apextech.group -> tunnel...'
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records"   -H "Authorization: Bearer $CF_TOKEN"   -H 'Content-Type: application/json'   -d '{"type":"CNAME","name":"tars","content":"'""'.cfargotunnel.com","proxied":true,"comment":"TARS webhook ingress via cloudflared tunnel (M8 2026-05-27)"}' | python3 -m json.tool

echo ''
echo 'Verify DNS:'
echo '  dig +short tars.apextech.group @1.1.1.1'
echo ''
echo 'Test webhook endpoint:'
echo '  curl -X GET https://tars.apextech.group/api/webhooks/github'
echo '  # Expect: HTTP 405 Method Not Allowed'
