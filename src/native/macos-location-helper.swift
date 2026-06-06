import CoreLocation
import Foundation

private let timeoutSeconds: TimeInterval = 2.8

private struct HelperSuccess: Encodable {
    let ok: Bool
    let lat: Double
    let lon: Double
    let accuracy_m: Double?
    let permission: String
    let timestamp: Double
    let placemark: PlacemarkOutput?
}

private struct HelperFailure: Encodable {
    let ok: Bool
    let error: String
    let message: String
    let permission: String?
    let timestamp: Double?
}

private struct PlacemarkOutput: Encodable {
    let city: String?
    let district: String?
    let street: String?
    let name: String?
    let formattedAddress: String?
    let country: String?
    let administrativeArea: String?
    let subAdministrativeArea: String?
    let postalCode: String?
}

private final class LocationOnceDelegate: NSObject, CLLocationManagerDelegate {
    private let manager: CLLocationManager
    private let geocoder: CLGeocoder
    private var didFinish = false
    private var timeout: Timer?

    init(manager: CLLocationManager = CLLocationManager(), geocoder: CLGeocoder = CLGeocoder()) {
        self.manager = manager
        self.geocoder = geocoder
        super.init()
        self.manager.delegate = self
        self.manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func start() {
        timeout = Timer.scheduledTimer(withTimeInterval: timeoutSeconds, repeats: false) { [weak self] _ in
            self?.finishFailure(error: "timeout", message: "CoreLocation did not produce a one-shot fix before helper timeout", permission: currentPermissionString())
        }

        switch CLLocationManager.authorizationStatus() {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied:
            finishFailure(error: "permission_denied", message: "CoreLocation permission denied", permission: "denied")
        case .restricted:
            finishFailure(error: "permission_restricted", message: "CoreLocation permission restricted", permission: "restricted")
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            manager.requestLocation()
        @unknown default:
            finishFailure(error: "unavailable", message: "Unknown CoreLocation authorization status", permission: "unknown")
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !didFinish else { return }
        switch CLLocationManager.authorizationStatus() {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied:
            finishFailure(error: "permission_denied", message: "CoreLocation permission denied", permission: "denied")
        case .restricted:
            finishFailure(error: "permission_restricted", message: "CoreLocation permission restricted", permission: "restricted")
        case .notDetermined:
            break
        @unknown default:
            finishFailure(error: "unavailable", message: "Unknown CoreLocation authorization status", permission: "unknown")
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard !didFinish else { return }
        let nsError = error as NSError
        if nsError.domain == kCLErrorDomain, let code = CLError.Code(rawValue: nsError.code) {
            switch code {
            case .denied:
                finishFailure(error: "permission_denied", message: error.localizedDescription, permission: "denied")
                return
            case .locationUnknown:
                finishFailure(error: "unavailable", message: error.localizedDescription, permission: currentPermissionString())
                return
            default:
                break
            }
        }
        finishFailure(error: "unknown", message: error.localizedDescription, permission: currentPermissionString())
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard !didFinish else { return }
        guard let location = locations.last else {
            finishFailure(error: "unavailable", message: "CoreLocation returned no locations", permission: currentPermissionString())
            return
        }
        reverseGeocode(location: location)
    }

    private func reverseGeocode(location: CLLocation) {
        geocoder.reverseGeocodeLocation(location) { [weak self] placemarks, _ in
            guard let self else { return }
            let placemark = placemarks?.first.map(makePlacemarkOutput)
            self.finishSuccess(location: location, placemark: placemark)
        }
    }

    private func finishSuccess(location: CLLocation, placemark: PlacemarkOutput?) {
        guard !didFinish else { return }
        didFinish = true
        timeout?.invalidate()
        manager.stopUpdatingLocation()
        geocoder.cancelGeocode()
        emit(HelperSuccess(
            ok: true,
            lat: location.coordinate.latitude,
            lon: location.coordinate.longitude,
            accuracy_m: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
            permission: "authorized",
            timestamp: location.timestamp.timeIntervalSince1970,
            placemark: placemark
        ))
        CFRunLoopStop(CFRunLoopGetMain())
    }

    private func finishFailure(error: String, message: String, permission: String?) {
        guard !didFinish else { return }
        didFinish = true
        timeout?.invalidate()
        manager.stopUpdatingLocation()
        geocoder.cancelGeocode()
        emit(HelperFailure(ok: false, error: error, message: message, permission: permission, timestamp: Date().timeIntervalSince1970))
        CFRunLoopStop(CFRunLoopGetMain())
    }
}

private func makePlacemarkOutput(_ placemark: CLPlacemark) -> PlacemarkOutput {
    let streetParts = [placemark.thoroughfare, placemark.subThoroughfare].compactMap { $0 }.filter { !$0.isEmpty }
    let formattedParts = [
        placemark.name,
        placemark.thoroughfare,
        placemark.locality,
        placemark.administrativeArea,
        placemark.country,
    ].compactMap { $0 }.filter { !$0.isEmpty }
    return PlacemarkOutput(
        city: placemark.locality,
        district: placemark.subLocality,
        street: streetParts.isEmpty ? placemark.thoroughfare : streetParts.joined(separator: " "),
        name: placemark.name,
        formattedAddress: formattedParts.isEmpty ? nil : formattedParts.joined(separator: ", "),
        country: placemark.country,
        administrativeArea: placemark.administrativeArea,
        subAdministrativeArea: placemark.subAdministrativeArea,
        postalCode: placemark.postalCode
    )
}

private func currentPermissionString() -> String {
    switch CLLocationManager.authorizationStatus() {
    case .authorizedAlways, .authorizedWhenInUse:
        return "authorized"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .notDetermined:
        return "not_determined"
    @unknown default:
        return "unknown"
    }
}

private func emit<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        let data = try encoder.encode(value)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        let encodedError = "{\"ok\":false,\"error\":\"unknown\",\"message\":\"failed to encode helper output\"}\n"
        FileHandle.standardOutput.write(Data(encodedError.utf8))
    }
}

if CommandLine.arguments.dropFirst() == ["--once"] {
    let delegate = LocationOnceDelegate()
    delegate.start()
    CFRunLoopRun()
} else {
    emit(HelperFailure(ok: false, error: "unavailable", message: "usage: swift macos-location-helper.swift --once", permission: nil, timestamp: Date().timeIntervalSince1970))
    exit(64)
}
