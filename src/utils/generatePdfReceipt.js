import RNHTMLtoPDF from "react-native-html-to-pdf";
import { Alert } from "react-native";

// data = your transaction object
// logoBase64 = base64 string of your logo
const generatePdfReceipt = async (data, logoBase64) => {
  try {
    const html = `
      <div style="font-family: Arial; padding: 20px;">
        <div style="text-align:center; margin-bottom:20px;">
          <img src="data:image/png;base64,${logoBase64}" 
               style="width:120px; height:auto; margin-bottom:10px;" />
          <h2 style="color:#007ACC;">Payment Receipt</h2>
        </div>

        <p><b>Transaction ID:</b> ${data?.transactionGroupId}</p>
        <p><b>Amount:</b> AED ${data?.amount}</p>
        <p><b>Date:</b> ${data?.date}</p>
        <p><b>Status:</b>   SUCCESS</p>

        <hr style="margin:20px 0;"/>

        <p style="text-align:center; font-size:12px; color:#555;">
          Thank you for using Sunduk Pay!
        </p>
      </div>
    `;

    let file = await RNHTMLtoPDF.convert({
      html,
      fileName: `receipt_${data?.transactionGroupId || Date.now()}`,
      directory: "Download", // Android: Downloads | iOS: Documents
    });

    Alert.alert("  PDF Receipt Saved", `Saved to: ${file.filePath}`);
    return file.filePath; // return path if you need to share later
  } catch (err) {
    console.error("PDF Error:", err);
    Alert.alert("   Failed", "Could not generate PDF receipt.");
    return null;
  }
};

export default generatePdfReceipt;
