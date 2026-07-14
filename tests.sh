#!/bin/bash

echo -e "\n=> Test without authentication"
curl -s "http://localhost:3000/shellcast/args/test/plain?hostname=foo&ip=10.0.0.1&mac=00:11:22:33:44:55&password=suburlpass"
echo -e "\n => Test with authentication but no credentials"
curl -s "http://localhost:3000/shellcast/auth/plain"
echo ""
echo -e "\n=> Test with valid x-remote-user authentication"
curl -H "X-Remote-User: remote_user1" -s "http://localhost:3000/shellcast/auth/plain"
echo -e "\n=> Test with NOT valid x-remote-user authentication"
curl -H "X-Remote-User: remote_userx" -s "http://localhost:3000/shellcast/auth/plain"
echo ""
echo -e "\n=> Test with valid x-group authentication"
curl -H "X-Group: group1" -s "http://localhost:3000/shellcast/auth/plain"
echo -e "\n=> Test with NOT valid x-group authentication"
curl -H "X-Group: groupx" -s "http://localhost:3000/shellcast/auth/plain"
echo ""
echo -e "\n=> Test with valid password authentication"
curl -s 'http://localhost:3000/shellcast/auth/plain?password=pa$$w0rd1'
echo -e "\n=> Test with NOT valid password authentication"
curl -s 'http://localhost:3000/shellcast/auth/plain?password=notvalidpa$$w0rd'
echo ""
