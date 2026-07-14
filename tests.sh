#!/bin/bash

title() {
    clear
    echo -e "\n### $1 #####################################################\n"
}

run() {
    echo -e "\$ $*\n"
    "$@"
}

pause() {
    echo
    read -n 1 -s -r -p "Press one key to continue..."
    echo
}

title "Test valid whitelisted chars"
run curl -Gs --data-urlencode "hostname=( f o o )" "http://localhost:3000/shellcast/args/test/plain?mac=00:11:22:33:44:55"

pause

title "Test NOT valid chars"
run curl -Gs --data-urlencode "hostname=&foo&" "http://localhost:3000/shellcast/args/test/plain?mac=00:11:22:33:44:55"

pause

title "Test without authentication"
run curl -i "http://localhost:3000/shellcast/args/test/plain?hostname=foo&ip=10.0.0.1&mac=00:11:22:33:44:55"

pause

title "Test with authentication but no credentials"
run curl -i "http://localhost:3000/shellcast/auth/plain"
echo ""

pause

title "Test with valid x-remote-user authentication"
run curl -i -H "X-Remote-User: remote_user1" "http://localhost:3000/shellcast/auth/plain"

pause

title "Test with NOT valid x-remote-user authentication"
run curl -i -H "X-Remote-User: remote_userx" "http://localhost:3000/shellcast/auth/plain"
echo ""

pause

title "Test with valid x-group authentication"
run curl -i -H "X-Group: group1" "http://localhost:3000/shellcast/auth/plain"

pause

title "Test with NOT valid x-group authentication"
run curl -i -H "X-Group: groupx" "http://localhost:3000/shellcast/auth/plain"
echo ""

pause

title "Test with valid password authentication"
run curl -i 'http://localhost:3000/shellcast/auth/plain?password=pa$$w0rd1'

pause

title "Test with NOT valid password authentication"
run curl -i 'http://localhost:3000/shellcast/auth/plain?password=notvalidpa$$w0rd'
echo ""

pause

title "Test with valid basicauth authentication"
run curl -i -u user1:password1 "http://localhost:3000/shellcast/auth/plain"

pause

title "Test with NOT valid USER basicauth authentication"
run curl -i -u userx:notvalidpassword "http://localhost:3000/shellcast/auth/plain"
echo ""

pause

title "Test with NOT valid PASSWORD basicauth authentication"
run curl -i -u user1:notvalidpassword "http://localhost:3000/shellcast/auth/plain"
echo ""

pause

title "Test with NOT authorized user basicauth authentication"
run curl -i -u user2:password2 "http://localhost:3000/shellcast/auth/plain"
echo ""

pause

title "Test with multiple valid authentications"
run curl -i -u user1:password1 -H "X-Remote-User: remote_user1" -H "X-Group: group1" 'http://localhost:3000/shellcast/auth/plain?password=pa$$w0rd1'
echo ""

pause

title "Test with multiple NOT valid authentications"
run curl -i -u userx:notvalidpassword -H "X-Remote-User: remote_userx" -H "X-Group: groupx" 'http://localhost:3000/shellcast/auth/plain?password=invalidpassword'
echo ""

pause

title "Test with multiple NOT valid authentications except local_user is valid"
run curl -i -u user1:password1 -H "X-Remote-User: remote_userx" -H "X-Group: groupx" 'http://localhost:3000/shellcast/auth/plain?password=invalidpassword'
echo ""

pause

title "Test with NOT valid mode"
run curl -i "http://localhost:3000/shellcast/auth/"
echo ""
