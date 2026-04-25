export default async function handler(req, res) {
  const { path } = req.query;
  const targetPath = Array.isArray(path) ? path.join("/") : path;
  const targetUrl = `http://142.93.211.38/api/${targetPath}/`;

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        ...(req.headers["authorization"] && {
          Authorization: req.headers["authorization"],
        }),
      },
    };

    // ✅ Only attach body for non-GET requests
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const apiRes = await fetch(targetUrl, fetchOptions);
    const text = await apiRes.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }

    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ message: "Proxy error", error: err.message });
  }
}