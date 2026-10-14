const prefix = "/appicon";

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return new Response("Not found", { status: 404 });
    }

    url.pathname = url.pathname.slice(prefix.length) || "/";
    return env.ASSETS.fetch(new Request(url, request));
  }
};

export default worker;
