#!/bin/bash

# Define colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[0;37m'
RESET='\033[0m'

for i in {0..20..1}
do
    echo -e "$i ${WHITE}white${RESET} hide ${RED}red${RESET} hide ${GREEN}green${RESET} hide ${YELLOW}yellow${RESET} hide ${BLUE}blue${RESET} hide ${MAGENTA}magenta${RESET} hide ${CYAN}cyan${RESET}"
    echo -e "${YELLOW}...lets sleep 0.$i s${RESET}"
    sleep 0.$i
done
