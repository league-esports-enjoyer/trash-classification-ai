
export async function preprocessImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // 1. Resize to a standard maximum size (1200px) for better detail
        let width = img.width;
        let height = img.height;
        const MAX_DIM = 1200;
        
        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;

        // 2. Draw image
        ctx.drawImage(img, 0, 0, width, height);

        // 3. Image Enhancement: Sharpening and Contrast
        // We use a convolution matrix for sharpening
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const pixels = new Uint8ClampedArray(data);
        
        // Simple Sharpening Kernel
        // [ 0, -1,  0]
        // [-1,  5, -1]
        // [ 0, -1,  0]
        const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
        const side = Math.round(Math.sqrt(kernel.length));
        const halfSide = Math.floor(side / 2);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const dstOff = (y * width + x) * 4;
            let r = 0, g = 0, b = 0;

            for (let cy = 0; cy < side; cy++) {
              for (let cx = 0; cx < side; cx++) {
                const scy = y + cy - halfSide;
                const scx = x + cx - halfSide;

                if (scy >= 0 && scy < height && scx >= 0 && scx < width) {
                  const srcOff = (scy * width + scx) * 4;
                  const wt = kernel[cy * side + cx];
                  r += pixels[srcOff] * wt;
                  g += pixels[srcOff + 1] * wt;
                  b += pixels[srcOff + 2] * wt;
                }
              }
            }

            data[dstOff] = r;
            data[dstOff + 1] = g;
            data[dstOff + 2] = b;
          }
        }
        
        ctx.putImageData(imageData, 0, 0);

        // 4. Subtle contrast boost
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.15;
        ctx.drawImage(canvas, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;

        // 5. Return as high-quality JPEG
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (e) {
        console.error("Advanced preprocessing failed, using original", e);
        resolve(dataUrl);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for preprocessing"));
    img.src = dataUrl;
  });
}
