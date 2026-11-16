#!/usr/bin/env nu
# Syntax-check the extension, confirm the manifest's files are packaged, and
# write dist/FocusPause-<version>.zip. The zip root is the extension root.

const extension_files = [
    "manifest.json"
    "icons/icon16.png"
    "icons/icon32.png"
    "icons/icon48.png"
    "icons/icon128.png"
    "background.js"
    "content.js"
    "page-hook.js"
    "src/policy.js"
    "src/media-session.js"
]

def repo-root [] {
    $env.FILE_PWD | path dirname
}

def referenced-files [manifest: record] {
    let worker = $manifest.background.service_worker
    let scripts = ($manifest.content_scripts | each {|entry| $entry.js } | flatten)
    let icons = if "icons" in $manifest { $manifest.icons | values } else { [] }
    $scripts | prepend $worker | append $icons
}

def main [] {
    let root = repo-root
    cd $root

    for file in $extension_files {
        if not ($file | path exists) {
            error make {msg: $"Missing extension file: ($file)"}
        }
        if ($file | str ends-with ".js") {
            ^node --check $file
        }
    }

    let manifest = open manifest.json
    for file in (referenced-files $manifest) {
        if not ($file in $extension_files) {
            error make {msg: $"manifest.json references ($file), which is not packaged"}
        }
    }

    let background = open --raw background.js
    if ($background | str contains "from './src/policy.js'") and not ("src/policy.js" in $extension_files) {
        error make {msg: "background.js imports src/policy.js, which is not packaged"}
    }

    let version = $manifest.version
    let stage = ($root | path join dist stage)
    rm --permanent --recursive --force $stage
    mkdir $stage
    for file in $extension_files {
        let dest = ($stage | path join $file)
        mkdir ($dest | path dirname)
        cp $file $dest
    }

    let zip = ($root | path join dist $"FocusPause-($version).zip")
    rm --permanent --force $zip
    cd $stage
    ^zip -r -X -q $zip .
    cd $root
    rm --permanent --recursive --force $stage
    print $"Built ($zip)"
}
