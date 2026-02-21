class Vicon < Formula
  desc "AI-powered media conversion CLI — describe what you want, get the commands"
  homepage "https://github.com/seanmozeik/vicon"
  version "0.1.1"
  license "MIT"

  # URL to bundled source (single JS file)
  url "https://github.com/seanmozeik/vicon/releases/download/v#{version}/vicon-#{version}.tar.gz"
  sha256 "038c33e1f17e058fbe499aa2107f62cf783a127240dd824302317c29d7696a67"

  depends_on "oven-sh/bun/bun"

  on_linux do
    depends_on "libsecret"
  end

  def install
    # Install all bundled files to libexec
    libexec.install Dir["*"]

    # Create wrapper script
    (bin/"vicon").write <<~EOS
      #!/bin/bash
      exec "#{Formula["bun"].opt_bin}/bun" "#{libexec}/index.js" "$@"
    EOS
  end

  test do
    assert_match "vicon", shell_output("#{bin}/vicon --help")
  end
end
