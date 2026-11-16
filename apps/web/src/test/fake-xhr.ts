/**
 * A stand-in for XMLHttpRequest, which `api` uses to send a file. It hands the request to the stubbed `fetch`, so a test
 * fakes the API in one place, and it reports half the bytes as sent before the answer comes, so progress can be seen.
 */
export class FakeXhr {
  status = 0;
  responseText = '';
  onload?: () => void;
  onerror?: () => void;
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  private method = '';
  private url = '';
  private headers: Record<string, string> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: Blob) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: body.size / 2, total: body.size });
    fetch(this.url, { method: this.method, headers: this.headers, body }).then(
      async (response) => {
        this.status = response.status;
        this.responseText = await response.text();
        this.onload?.();
      },
      () => this.onerror?.(),
    );
  }
}
