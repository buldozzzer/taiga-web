#!/bin/sh
# Picks the site config: HTTPS once the certificate for $DOMAIN is issued, plain HTTP before that.
# Reloads nginx every 6 hours so a certificate renewed by certbot is picked up.
set -eu

export DOMAIN="${DOMAIN:-_}"
rm -f /etc/nginx/conf.d/default.conf

if [ "$DOMAIN" != _ ] && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  template=panel
else
  template=bootstrap
  echo "taiga: no certificate for $DOMAIN, serving plain HTTP" >&2
fi
envsubst '${DOMAIN}' < "/etc/nginx/taiga/$template.conf.template" > /etc/nginx/conf.d/taiga.conf

(while sleep 6h; do nginx -s reload; done) </dev/null >/dev/null 2>&1 &
