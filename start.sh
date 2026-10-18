#!/bin/bash

while true; do
    git pull
    npm i
    node index.js
    sleep 5
done