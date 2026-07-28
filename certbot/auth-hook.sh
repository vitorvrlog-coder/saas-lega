#!/bin/sh
set -e
RECORD_NAME="_acme-challenge.${CERTBOT_DOMAIN}"
echo "TXT_NAME=${RECORD_NAME}" > /etc/letsencrypt/challenge.txt
echo "TXT_VALUE=${CERTBOT_VALIDATION}" >> /etc/letsencrypt/challenge.txt
echo "Waiting for DNS propagation of ${RECORD_NAME} = ${CERTBOT_VALIDATION}" >&2

i=0
while [ $i -lt 80 ]; do
    RESULT=$(nslookup -type=TXT "${RECORD_NAME}" 8.8.8.8 2>/dev/null | grep 'text =' | sed 's/.*text = "\(.*\)"/\1/')
    if [ "$RESULT" = "${CERTBOT_VALIDATION}" ]; then
        echo "DNS propagated, continuing." >&2
        sleep 5
        exit 0
    fi
    sleep 15
    i=$((i+1))
done
echo "Timed out waiting for DNS TXT record." >&2
exit 1
