# The CI image of the owner's machines: one container per CI job (scripts/ci/container-executor.ts),
# a stand-in for GitHub's ubuntu-24.04 runner with the tools ci.yml pins (CI_TOOLS in
# lib/testing/ci/dag.ts). Every download is pinned by version and checksum, the base by digest.
# Build it from the machine runner's trusted checkout (docs/technical/testing.md, "Run CI on the
# owner's machines"):
#   docker build --build-arg TRUSTED_COMMIT=$(git rev-parse HEAD) -t werkflow-ci:<commit> ci/image
# The label names that commit; the runner refuses an image built from another.
FROM ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
ARG TARGETARCH
ARG TRUSTED_COMMIT
# The Mac's user id and the group of Colima's Docker socket, so files on the shared folders stay the
# owner's. A rootless slot runs its containers as root, which is the slot's own user.
ARG RUNNER_UID=501
ARG DOCKER_SOCKET_GID=991
LABEL org.werkflow.trusted-commit=$TRUSTED_COMMIT
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq sudo unzip xz-utils openssl tar gzip iproute2 procps util-linux \
      docker.io python3 zip make lsof file postgresql-client wget rsync zstd perl bc \
    && rm -rf /var/lib/apt/lists/*
# Node 22, as actions/setup-node's node-version: 22.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x64; sum=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8 ;; \
      arm64) arch=arm64; sum=2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09 ;; \
      *) echo "no Node for $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v22.23.5/node-v22.23.5-linux-$arch.tar.xz" -o /tmp/node.tar.xz; \
    echo "$sum  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; rm /tmp/node.tar.xz
# Supabase CLI 2.116.0, as .github/actions/supabase-cli.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) sum=5b3031cb297d51b25be4c284e4c852254460ec722ec221d3b81b07d55acfd158 ;; \
      arm64) sum=015a45756bb8459716a4b44b020605adc11956cd7d0bd5824aec2ed1c8287933 ;; \
    esac; \
    curl -fsSL "https://github.com/supabase/cli/releases/download/v2.116.0/supabase_2.116.0_linux_$TARGETARCH.tar.gz" -o /tmp/supabase.tar.gz; \
    echo "$sum  /tmp/supabase.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin supabase; rm /tmp/supabase.tar.gz
# Chromium and its system packages, for Playwright 1.62.1, in the image: no job writes a browser
# that a later run starts.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && npx --yes playwright@1.62.1 install --with-deps chromium && rm -rf /var/lib/apt/lists/*
RUN userdel -r ubuntu 2>/dev/null; groupadd -g "$DOCKER_SOCKET_GID" dockersock \
    && useradd -m -u "$RUNNER_UID" -s /bin/bash runner \
    && usermod -aG docker,dockersock runner && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner
# Bun 1.4.4 for every user, as oven-sh/setup-bun.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x64; sum=bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c ;; \
      arm64) arch=aarch64; sum=baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e ;; \
    esac; \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-$arch.zip" -o /tmp/bun.zip; \
    echo "$sum  /tmp/bun.zip" | sha256sum -c -; \
    unzip -q /tmp/bun.zip -d /tmp; install -m 0755 "/tmp/bun-linux-$arch/bun" /usr/local/bin/bun; \
    ln -s /usr/local/bin/bun /usr/local/bin/bunx; rm -rf /tmp/bun.zip "/tmp/bun-linux-$arch"
COPY --chmod=0755 stage.sh /usr/local/bin/werkflow-ci-stage
COPY --chmod=0755 job.sh /usr/local/bin/werkflow-ci-job
COPY --chmod=0755 probe.sh /usr/local/bin/werkflow-ci-probe
USER runner
ENV CI=true
WORKDIR /home/runner
RUN mkdir -p /home/runner/.bun/install/cache && git config --global --add safe.directory '*'
