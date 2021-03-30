#!/usr/bin/env node

import App from "./src/App.js"

let config

try {
  import(process.cwd() + "/smartes.js").then((config) => {
    App(config.default)
  })
} catch (e) {
  console.error('Could not load "smartes.js" file')
  process.exit(1)
}
