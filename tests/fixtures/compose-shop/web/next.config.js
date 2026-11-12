// Browser calls to /api/* are forwarded to the users service.
module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://users:8080/:path*" }];
  },
};
