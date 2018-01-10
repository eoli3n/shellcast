#!/bin/bash
for i in {0..5..1}
do
    echo "$1 TASK ok:"
    echo "$1 TASK fatal:"
    echo "$1 TASK changed:"
    echo "$1 TASK skipping:"
    sleep $i
done
