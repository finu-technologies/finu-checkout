// hooks/useRazorpay.js

export function useRazorpay() {
  const loadScript = () =>
    new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror  = () => resolve(false);
      document.body.appendChild(script);
    });

  /**
   * Open a Razorpay checkout modal and return a promise that resolves
   * on payment success or rejects on failure/dismissal.
   *
   * @param {object}  options           - Razorpay checkout options
   * @param {boolean} [lockModal=false] - If true, disable backdrop/escape
   *                                     dismissal (use for UPI leg where
   *                                     card has already been charged).
   */
  const openCheckout = async (options, lockModal = false) => {
    const loaded = await loadScript();
    if (!loaded) throw new Error('Razorpay SDK failed to load');

    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        ...options,
        handler: (response) => resolve(response),
        modal: {
          // When lockModal is true (UPI leg): prevent accidental dismissal
          // so users can't close the modal and leave card payment unmatched.
          backdropclose: !lockModal,
          escape:        !lockModal,
          ondismiss: () => reject(new Error('Payment cancelled by user')),
        },
      });

      rzp.on('payment.failed', (response) => {
        reject(new Error(response.error?.description || 'Payment failed'));
      });

      rzp.open();
    });
  };

  return { openCheckout };
}
