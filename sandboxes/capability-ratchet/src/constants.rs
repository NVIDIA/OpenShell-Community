// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Security-sensitive constants — single source of truth.

use std::collections::HashSet;

/// Shell binaries — used by `bash_unwrap` for `-c` unwrapping.
pub static SHELLS: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| ["bash", "sh", "zsh", "ksh", "dash"].into_iter().collect());

/// All tool names treated as bash/shell invocations.
pub static BASH_TOOL_NAMES: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| {
        [
            "bash",
            "sh",
            "zsh",
            "ksh",
            "dash",
            "shell",
            "execute_command",
        ]
        .into_iter()
        .collect()
    });

/// GTFOBins-informed network commands.
pub static NETWORK_COMMANDS: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| {
        [
            "curl",
            "wget",
            "aria2c",
            "axel",
            "nc",
            "netcat",
            "ncat",
            "socat",
            "ssh",
            "scp",
            "sftp",
            "rsync",
            "sshfs",
            "ftp",
            "tftp",
            "lftp",
            "telnet",
            "rlogin",
            "rsh",
            "rcp",
            "http",
            "https", // httpie
            "hping3",
            "smbclient",
            "whois",
            "finger",
            "ab",
            "gawk", // GTFOBins: /inet/tcp sockets
        ]
        .into_iter()
        .collect()
    });

/// Interpreter commands.
pub static INTERPRETER_COMMANDS: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| {
        [
            "python", "python3", "python2", "ruby", "node", "perl", "php", "lua", "julia",
            "Rscript",
        ]
        .into_iter()
        .collect()
    });

/// Network code indicators for interpreter inline code analysis.
pub static NETWORK_CODE_INDICATORS: &[&str] = &[
    "urllib",
    "requests",
    "httpx",
    "aiohttp",
    "socket",
    "http.client",
    "httplib",
    "ftplib",
    "smtplib",
    "telnetlib",
    "fetch(",
    "axios",
    ".get(",
    ".post(",
    "net/http",
    "open-uri",
    "httparty",
    "LWP",
    "HTTP::",
    "IO::Socket",
    "curl_",
    "fsockopen",
    "file_get_contents",
];
