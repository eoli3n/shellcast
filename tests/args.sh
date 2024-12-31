#!/bin/bash

GREEN='\033[0;32m'
RESET='\033[0m'

printf "%-20s" "Hostname:"
printf "$1\n"
printf "%-20s" "IP:"
printf "$2\n"
printf "%-20s" "Mac:"
printf "$3\n"
printf "%-20s" "All:"
printf "${GREEN}$4${RESET}\n"

