#!/bin/bash

echo "=> Test without authentication"
curl -s "http://localhost:3000/shellcast/args/test/plain?hostname=foo&ip=10.0.0.1&mac=00:11:22:33:44:55&password=suburlpass"
echo "=> Test with authentication but no credentials"
curl -s "http://localhost:3000/shellcast/auth/plain"
