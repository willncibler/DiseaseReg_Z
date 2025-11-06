pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedRegistry is ZamaEthereumConfig {
    struct PatientRecord {
        euint32 encryptedDiagnosis;
        uint256 publicAge;
        uint256 publicLocation;
        string encryptedMedicalHistory;
        address patientAddress;
        uint256 registrationDate;
        uint32 decryptedDiagnosis;
        bool isVerified;
    }

    mapping(string => PatientRecord) public patientRecords;
    string[] public patientIds;

    event PatientRecordCreated(string indexed patientId, address indexed patient);
    event DiagnosisDecrypted(string indexed patientId, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {}

    function registerPatient(
        string calldata patientId,
        externalEuint32 encryptedDiagnosis,
        bytes calldata diagnosisProof,
        uint256 age,
        uint256 location,
        string calldata medicalHistory
    ) external {
        require(bytes(patientRecords[patientId].encryptedMedicalHistory).length == 0, "Patient already registered");
        require(FHE.isInitialized(FHE.fromExternal(encryptedDiagnosis, diagnosisProof)), "Invalid encrypted diagnosis");

        patientRecords[patientId] = PatientRecord({
            encryptedDiagnosis: FHE.fromExternal(encryptedDiagnosis, diagnosisProof),
            publicAge: age,
            publicLocation: location,
            encryptedMedicalHistory: medicalHistory,
            patientAddress: msg.sender,
            registrationDate: block.timestamp,
            decryptedDiagnosis: 0,
            isVerified: false
        });

        FHE.allowThis(patientRecords[patientId].encryptedDiagnosis);
        FHE.makePubliclyDecryptable(patientRecords[patientId].encryptedDiagnosis);
        patientIds.push(patientId);

        emit PatientRecordCreated(patientId, msg.sender);
    }

    function verifyDiagnosis(
        string calldata patientId,
        bytes memory clearDiagnosis,
        bytes memory decryptionProof
    ) external {
        require(bytes(patientRecords[patientId].encryptedMedicalHistory).length > 0, "Patient not found");
        require(!patientRecords[patientId].isVerified, "Diagnosis already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(patientRecords[patientId].encryptedDiagnosis);

        FHE.checkSignatures(cts, clearDiagnosis, decryptionProof);
        uint32 decodedValue = abi.decode(clearDiagnosis, (uint32));

        patientRecords[patientId].decryptedDiagnosis = decodedValue;
        patientRecords[patientId].isVerified = true;

        emit DiagnosisDecrypted(patientId, decodedValue);
    }

    function getEncryptedDiagnosis(string calldata patientId) external view returns (euint32) {
        require(bytes(patientRecords[patientId].encryptedMedicalHistory).length > 0, "Patient not found");
        return patientRecords[patientId].encryptedDiagnosis;
    }

    function getPatientRecord(string calldata patientId) external view returns (
        uint256 age,
        uint256 location,
        string memory medicalHistory,
        address patientAddress,
        uint256 registrationDate,
        bool isVerified,
        uint32 decryptedDiagnosis
    ) {
        require(bytes(patientRecords[patientId].encryptedMedicalHistory).length > 0, "Patient not found");
        PatientRecord storage record = patientRecords[patientId];

        return (
            record.publicAge,
            record.publicLocation,
            record.encryptedMedicalHistory,
            record.patientAddress,
            record.registrationDate,
            record.isVerified,
            record.decryptedDiagnosis
        );
    }

    function getAllPatientIds() external view returns (string[] memory) {
        return patientIds;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == this.supportsInterface.selector;
    }
}


