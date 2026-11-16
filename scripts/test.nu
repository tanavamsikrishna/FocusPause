#!/usr/bin/env nu
# Run the Node unit tests for the pause rules and the resume set.

def main [] {
    cd ($env.FILE_PWD | path dirname)
    ^node --test
}
