# Sourced by the scripts that send a secret in a curl header.
# Usage: curl --config <(curl_headers <<< "Authorization: Bearer ${TOKEN}") [curl options] <URL>
#
# Turns each header line on stdin into a line of curl's config syntax. curl reads them from a
# file descriptor, so no secret shows in a process's arguments: any local user of a shared
# runner can read those in /proc/<pid>/cmdline. A function and a process substitution run no
# new program, so the secret is in no argument list on its way to curl either.
curl_headers() {
  local line
  while IFS= read -r line; do
    line="${line//\\/\\\\}"
    printf 'header = "%s"\n' "${line//\"/\\\"}"
  done
}
