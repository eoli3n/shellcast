#!/bin/bash
node -e 'console.log(require("bcrypt").hashSync(process.argv[1], 10))' "$1"
